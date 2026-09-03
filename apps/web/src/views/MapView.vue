<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import { io, type Socket } from 'socket.io-client'
import { apiBaseUrl, apiRequest, type Friendship } from '../api'

type Point = { userId: string; lat: number; lng: number; accuracy?: number; updatedAt: number }

const mapElement = ref<HTMLElement | null>(null)
const notice = ref('')
const connection = ref('connecting')
const historyVisible = ref(false)
const historyLoading = ref(false)
const historyError = ref('')
const historyPointCount = ref(0)
const friends = ref<Friendship[]>([])
const selectedFriendId = ref<string | null>(null)
const points = new Map<string, Point>()
const markers = new Map<string, L.Marker>()
const stoppedViewing = new Set<string>()

let map: L.Map | undefined
let markerCluster: L.MarkerClusterGroup | undefined
let socket: Socket | undefined
let watchId: number | undefined
let noticeTimer: ReturnType<typeof setTimeout> | undefined
let clock: ReturnType<typeof setInterval> | undefined
let historyLine: L.Polyline | undefined

function getInitial(userId: string): string {
  const username = usernameFor(userId)
  return username.charAt(0).toUpperCase()
}

function usernameFor(userId: string): string {
  return friends.value.find((item) => item.friend.id === userId)?.friend.username ?? 'Friend'
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (seconds < 30) return 'just now'
  if (minutes < 1) return `${seconds}s ago`
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return 'long ago'
}

function markerFor(point: Point): L.DivIcon {
  const age = Date.now() - point.updatedAt
  const stale = age > 60_000
  const username = usernameFor(point.userId)
  const initial = getInitial(point.userId)
  const relativeTime = formatRelativeTime(point.updatedAt)

  const html = `
    <div class="marker-content">
      <div class="marker-avatar">${initial}</div>
      <div class="marker-info">
        <div class="marker-name">${username}</div>
        <div class="marker-time">${relativeTime}</div>
      </div>
    </div>
  `

  return L.divIcon({
    className: `friend-marker ${stale ? 'stale' : ''}`,
    html,
    iconSize: [160, 54],
    iconAnchor: [80, 27],
  })
}

function clusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  return L.divIcon({
    className: 'friend-cluster',
    html: `<span>${cluster.getChildCount()}</span>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  })
}

function updateMarker(point: Point): void {
  if (!map || !markerCluster) return
  const marker = markers.get(point.userId)

  if (marker) {
    marker.setLatLng([point.lat, point.lng]).setIcon(markerFor(point))
  } else {
    const newMarker = L.marker([point.lat, point.lng], {
      icon: markerFor(point),
    })

    newMarker.on('click', () => {
      selectedFriendId.value = point.userId
    })

    markers.set(point.userId, newMarker)
    markerCluster.addLayer(newMarker)
  }
}

function showNotice(text: string): void {
  notice.value = text
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    notice.value = ''
  }, 3500)
}

function receiveSnapshot(snapshot: Point[]): void {
  snapshot.forEach((point) => {
    if (stoppedViewing.has(point.userId)) return
    points.set(point.userId, point)
    updateMarker(point)
  })
}

function stopViewing(userId: string): void {
  stoppedViewing.add(userId)
  socket?.emit('view:stop', { friendId: userId })
  const marker = markers.get(userId)
  if (marker) markerCluster?.removeLayer(marker)
  markers.delete(userId)
  points.delete(userId)
  selectedFriendId.value = null
}

async function toggleHistory(): Promise<void> {
  historyVisible.value = !historyVisible.value
  historyError.value = ''
  if (!historyVisible.value) {
    historyLine?.remove()
    historyLine = undefined
    historyPointCount.value = 0
    return
  }

  if (!map) return
  historyLoading.value = true
  try {
    const result = await apiRequest<{
      points: { lat: number; lng: number }[]
    }>('/location/history')
    historyPointCount.value = result.points.length
    historyLine?.remove()
    if (result.points.length > 1) {
      historyLine = L.polyline(
        result.points.map((point) => [point.lat, point.lng] as [number, number]),
        { color: '#c25d3e', weight: 4, opacity: 0.8 },
      ).addTo(map)
      map.fitBounds(historyLine.getBounds(), { padding: [32, 32] })
    }
  } catch (err) {
    historyError.value = err instanceof Error ? err.message : 'Could not load location history'
  } finally {
    historyLoading.value = false
  }
}

function startLocationWatch(): void {
  if (!navigator.geolocation) {
    showNotice('Geolocation is not available in this browser.')
    return
  }

  let lastEmitTime = 0

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      const now = Date.now()
      if (!socket || now - lastEmitTime < 5_000) return

      lastEmitTime = now
      socket.emit('location:update', {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: now,
      })
    },
    () => showNotice('Location permission is needed to share your position.'),
    { enableHighAccuracy: true, maximumAge: 10_000 }
  )
}

onMounted(async () => {
  try {
    friends.value = await apiRequest<Friendship[]>('/friendships')

    if (mapElement.value) {
      map = L.map(mapElement.value, { maxZoom: 19 }).setView([20, 0], 2)
    }

    markerCluster = L.markerClusterGroup({
      maxClusterRadius: 40,
      iconCreateFunction: clusterIcon,
    })
    markerCluster.addTo(map!)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map!)

    socket = io(apiBaseUrl, { auth: { token: localStorage.getItem('friendmap_token') } })

    socket.on('connect', () => {
      connection.value = 'live'
      socket?.emit('view:friends')
      startLocationWatch()
    })

    socket.on('disconnect', () => {
      connection.value = 'offline'
    })

    socket.on('location:snapshot', receiveSnapshot)

    socket.on('location:update', (point: Point) => {
      if (stoppedViewing.has(point.userId)) return
      points.set(point.userId, point)
      updateMarker(point)
    })

    socket.on('location:hidden', ({ userId }: { userId: string }) => {
      const marker = markers.get(userId)
      if (marker) markerCluster?.removeLayer(marker)
      markers.delete(userId)
      points.delete(userId)
      showNotice(`${usernameFor(userId)} is no longer sharing their location.`)
    })

    socket.on('location:rejected', ({ reason }: { reason: string }) => {
      showNotice(`Location update rejected: ${reason}`)
    })

    // Refresh marker times every 15 seconds
    clock = setInterval(() => {
      markers.forEach((marker, userId) => {
        const point = points.get(userId)
        if (point) marker.setIcon(markerFor(point))
      })
    }, 15_000)
  } catch (err) {
    showNotice(err instanceof Error ? err.message : 'Could not load friends')
  }
})

onBeforeUnmount(() => {
  if (watchId !== undefined) navigator.geolocation.clearWatch(watchId)
  if (clock) clearInterval(clock)
  if (noticeTimer) clearTimeout(noticeTimer)
  socket?.disconnect()
  historyLine?.remove()
  map?.remove()
})
</script>

<template>
  <section class="map-page">
    <div class="map-toolbar">
      <div>
        <p class="eyebrow">LIVE VIEW</p>
        <h1>Friend map</h1>
      </div>
      <span class="status">
        <i :class="connection"></i>{{ connection }}
      </span>
      <button class="button secondary history-toggle" type="button" @click="toggleHistory">
        {{ historyVisible ? 'Hide history' : 'My history' }}
      </button>
    </div>

    <div ref="mapElement" class="map-canvas"></div>

    <div v-if="notice" class="toast">{{ notice }}</div>

    <div v-if="historyVisible && historyLoading" class="history-status">Loading history...</div>
    <div v-if="historyVisible && !historyLoading && historyError" class="history-status error">
      {{ historyError }}
    </div>
    <div v-if="historyVisible && !historyLoading && !historyError && historyPointCount < 2" class="history-status">
      No trail available yet.
    </div>

    <div class="map-legend">
      <span class="legend-dot"></span> Shared location
      <span class="legend-dot stale-dot"></span> Stale for 60s+
    </div>

    <!-- Friend Popup Modal -->
    <div v-if="selectedFriendId" class="friend-popup-overlay" @click="selectedFriendId = null">
      <div class="friend-popup" @click.stop>
        <button class="popup-close" @click="selectedFriendId = null">✕</button>
        <div class="popup-content">
          <div class="popup-avatar">{{ getInitial(selectedFriendId) }}</div>
          <h3>{{ usernameFor(selectedFriendId) }}</h3>
          <p class="popup-time" v-if="points.get(selectedFriendId)">
            Last updated: {{ formatRelativeTime(points.get(selectedFriendId)!.updatedAt) }}
          </p>
          <button class="button primary" @click="stopViewing(selectedFriendId!)">
            Stop Viewing
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.friend-popup-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(23, 51, 50, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.friend-popup {
  background: white;
  border-radius: 12px;
  padding: 28px;
  box-shadow: 0 10px 40px rgba(41, 64, 49, 0.15);
  max-width: 320px;
  position: relative;
}

.popup-close {
  position: absolute;
  top: 12px;
  right: 12px;
  background: transparent;
  border: none;
  font-size: 24px;
  color: #71807a;
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.popup-close:hover {
  color: #173b32;
}

.popup-content {
  text-align: center;
}

.popup-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #c25d3e;
  color: white;
  font: bold 24px Arial, sans-serif;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 14px;
}

.popup-content h3 {
  margin: 0 0 8px;
  font-size: 20px;
  color: #173b32;
}

.popup-time {
  margin: 0 0 18px;
  color: #71807a;
  font-size: 12px;
}

.popup-content .button {
  width: 100%;
}
</style>