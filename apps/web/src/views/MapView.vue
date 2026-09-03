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
const friends = ref<Friendship[]>([])
const points = new Map<string, Point>()
const markers = new Map<string, L.Marker>()
let map: L.Map | undefined
let markerCluster: L.MarkerClusterGroup | undefined
let socket: Socket | undefined
let watchId: number | undefined
let noticeTimer: ReturnType<typeof setTimeout> | undefined
let clock: ReturnType<typeof setInterval> | undefined

function usernameFor(userId: string) { return friends.value.find((item) => item.friend.id === userId)?.friend.username ?? 'Friend' }
function markerFor(point: Point) {
  const age = Date.now() - point.updatedAt
  const stale = age > 60_000
  return L.divIcon({ className: `friend-marker ${stale ? 'stale' : ''}`, html: `<span>${usernameFor(point.userId)}</span>`, iconSize: [130, 32], iconAnchor: [65, 16] })
}
function clusterIcon(cluster: L.MarkerCluster) {
  return L.divIcon({ className: 'friend-cluster', html: `<span>${cluster.getChildCount()}</span>`, iconSize: [38, 38], iconAnchor: [19, 19] })
}
function updateMarker(point: Point) {
  if (!map || !markerCluster) return
  const marker = markers.get(point.userId)
  if (marker) marker.setLatLng([point.lat, point.lng]).setIcon(markerFor(point))
  else {
    const newMarker = L.marker([point.lat, point.lng], { icon: markerFor(point) })
    markers.set(point.userId, newMarker)
    markerCluster.addLayer(newMarker)
  }
}
function showNotice(text: string) { notice.value = text; if (noticeTimer) clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice.value = '' }, 3500) }
function receiveSnapshot(snapshot: Point[]) { snapshot.forEach((point) => { points.set(point.userId, point); updateMarker(point) }) }
function startLocationWatch() {
  if (!navigator.geolocation) { showNotice('Geolocation is not available in this browser.'); return }
  let lastEmitTime = 0
  watchId = navigator.geolocation.watchPosition((position) => {
    const now = Date.now()
    if (!socket || now - lastEmitTime < 5_000) return
    lastEmitTime = now
    socket.emit('location:update', { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, timestamp: now })
  }, () => showNotice('Location permission is needed to share your position.'), { enableHighAccuracy: true, maximumAge: 10_000 })
}
onMounted(async () => {
  try {
    friends.value = await apiRequest<Friendship[]>('/friendships')
    if (mapElement.value) map = L.map(mapElement.value, { maxZoom: 19 }).setView([20, 0], 2)
    markerCluster = L.markerClusterGroup({ maxClusterRadius: 40, iconCreateFunction: clusterIcon })
    markerCluster.addTo(map!)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map!)
    socket = io(apiBaseUrl, { auth: { token: localStorage.getItem('friendmap_token') } })
    socket.on('connect', () => { connection.value = 'live'; socket?.emit('view:friends'); startLocationWatch() })
    socket.on('disconnect', () => { connection.value = 'offline' })
    socket.on('location:snapshot', receiveSnapshot)
    socket.on('location:update', (point: Point) => { points.set(point.userId, point); updateMarker(point) })
    socket.on('location:hidden', ({ userId }: { userId: string }) => { const marker = markers.get(userId); if (marker) markerCluster?.removeLayer(marker); markers.delete(userId); points.delete(userId); showNotice(`${usernameFor(userId)} is no longer sharing their location.`) })
    socket.on('location:rejected', ({ reason }: { reason: string }) => showNotice(`Location update rejected: ${reason}`))
    clock = setInterval(() => markers.forEach((marker, userId) => { const point = points.get(userId); if (point) marker.setIcon(markerFor(point)) }), 30_000)
  } catch (err) {
    showNotice(err instanceof Error ? err.message : 'Could not load friends')
  }
})
onBeforeUnmount(() => { if (watchId !== undefined) navigator.geolocation.clearWatch(watchId); if (clock) clearInterval(clock); if (noticeTimer) clearTimeout(noticeTimer); socket?.disconnect(); map?.remove() })
</script>

<template>
  <section class="map-page"><div class="map-toolbar"><div><p class="eyebrow">LIVE VIEW</p><h1>Friend map</h1></div><span class="status"><i :class="connection"></i>{{ connection }}</span></div><div ref="mapElement" class="map-canvas"></div><div v-if="notice" class="toast">{{ notice }}</div><div class="map-legend"><span class="legend-dot"></span> Shared location <span class="legend-dot stale-dot"></span> Stale for 60s+</div></section>
</template>