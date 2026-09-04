<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import { io, type Socket } from 'socket.io-client'
import { apiBaseUrl, apiRequest, type Friendship } from '../api'

type Point = {
  userId: string
  lat: number
  lng: number
  accuracy?: number
  updatedAt: number
}

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
let lastEmitTime = 0

let noticeTimer: ReturnType<typeof setTimeout> | undefined
let clock: ReturnType<typeof setInterval> | undefined

let historyLine: L.Polyline | undefined


/* =========================================================
   USER HELPERS
   ========================================================= */

function usernameFor(userId: string): string {
  return (
    friends.value.find(
      (item) => item.friend.id === userId,
    )?.friend.username ?? 'Friend'
  )
}

function getInitial(userId: string): string {
  return usernameFor(userId)
    .charAt(0)
    .toUpperCase()
}

const FRIEND_COLORS = [
  '#e56b4f', /* coral */
  '#257a66', /* emerald / forest */
  '#3b6fd4', /* ocean blue */
  '#d9822b', /* warm amber */
  '#7a52b3', /* royal purple */
  '#d44a78', /* berry rose */
  '#1b877a', /* deep teal */
  '#c75034', /* terracotta */
]

function colorForUser(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0
  }
  return FRIEND_COLORS[hash % FRIEND_COLORS.length]
}

function userIdForMarker(marker: L.Marker): string | undefined {
  if ((marker as any)._userId) return (marker as any)._userId
  for (const [uid, m] of markers.entries()) {
    if (m === marker) return uid
  }
  return undefined
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (seconds < 30) {
    return 'just now'
  }

  if (minutes < 1) {
    return `${seconds}s ago`
  }

  if (minutes < 60) {
    return `${minutes}m ago`
  }

  if (hours < 24) {
    return `${hours}h ago`
  }

  return 'long ago'
}


/* =========================================================
   MAP MARKERS
   ========================================================= */

function markerFor(point: Point): L.DivIcon {
  const age = Date.now() - point.updatedAt

  const stale = age > 60_000

  const username = usernameFor(point.userId)
  const initial = getInitial(point.userId)
  const color = colorForUser(point.userId)

  const relativeTime = formatRelativeTime(point.updatedAt)

  const html = `
    <div class="marker-content">
      <div class="marker-avatar" style="background: ${stale ? 'var(--color-stale)' : color}">
        ${initial}
      </div>

      <div class="marker-info">
        <span class="marker-name">
          ${username}
        </span>

        <span class="marker-time">
          ${relativeTime}
        </span>
      </div>
    </div>
  `

  return L.divIcon({
    className: `friend-marker ${stale ? 'stale' : ''}`,

    html,

    iconSize: [46, 46],
    iconAnchor: [23, 23],
  })
}


/* =========================================================
   CLUSTERS (AVATAR STACK DESIGN)
   ========================================================= */

function clusterIcon(
  cluster: L.MarkerCluster,
): L.DivIcon {
  const count = cluster.getChildCount()
  const childMarkers = cluster.getAllChildMarkers()

  /* Collect unique friends in this cluster */
  const userIds: string[] = []
  for (const m of childMarkers) {
    const uid = (m as any)._userId || userIdForMarker(m)
    if (uid && !userIds.includes(uid)) {
      userIds.push(uid)
    }
  }

  const friendsInfo = userIds.map((uid) => ({
    name: usernameFor(uid),
    initial: getInitial(uid),
    color: colorForUser(uid),
  }))

  /* Up to 3 friend avatar bubbles, plus a "+N" overflow bubble if count > 3 */
  const showAvatarsCount = Math.min(count, 3)
  const remainingCount = count > 3 ? count - 3 : 0

  /* Tooltip text showing friend names on hover */
  let tooltipText = ''
  if (friendsInfo.length >= 3) {
    if (count === 3) {
      tooltipText = `${friendsInfo[0].name}, ${friendsInfo[1].name} & ${friendsInfo[2].name}`
    } else {
      const more = count - 3
      tooltipText = `${friendsInfo[0].name}, ${friendsInfo[1].name}, ${friendsInfo[2].name} +${more} more`
    }
  } else if (friendsInfo.length === 2) {
    tooltipText = count > 2 ? `${friendsInfo[0].name}, ${friendsInfo[1].name} +${count - 2}` : `${friendsInfo[0].name} & ${friendsInfo[1].name}`
  } else if (friendsInfo.length === 1) {
    tooltipText = count > 1 ? `${friendsInfo[0].name} & ${count - 1} other` : friendsInfo[0].name
  } else {
    tooltipText = `${count} friends`
  }

  /* Render stacked avatar bubbles */
  const bubbleSize = 36
  const overlap = 14
  const totalBubbles = showAvatarsCount + (remainingCount > 0 ? 1 : 0)

  let bubblesHtml = ''
  for (let i = 0; i < showAvatarsCount; i++) {
    const friend = friendsInfo[i]
    const initial = friend?.initial ?? String(i + 1)
    const bg = friend?.color ?? 'var(--color-primary)'
    const leftOffset = i * (bubbleSize - overlap)
    const zIdx = i + 1

    bubblesHtml += `
      <div class="cluster-avatar-bubble cluster-avatar-bubble--${i}" style="left:${leftOffset}px;z-index:${zIdx};background:${bg};">
        ${initial}
      </div>
    `
  }

  if (remainingCount > 0) {
    const leftOffset = showAvatarsCount * (bubbleSize - overlap)
    const zIdx = showAvatarsCount + 1
    bubblesHtml += `
      <div class="cluster-avatar-bubble cluster-avatar-bubble--more" style="left:${leftOffset}px;z-index:${zIdx};">
        +${remainingCount}
      </div>
    `
  }

  const stackWidth = totalBubbles * bubbleSize - (totalBubbles - 1) * overlap
  const totalWidth = stackWidth + 14
  const totalHeight = bubbleSize + 14

  return L.divIcon({
    className: 'friend-cluster',
    html: `
      <div class="cluster-stack-container" style="width:${totalWidth}px;height:${totalHeight}px;">
        <div class="cluster-ripple cluster-ripple--1"></div>
        <div class="cluster-ripple cluster-ripple--2"></div>
        <div class="cluster-stack" style="width:${stackWidth}px;height:${bubbleSize}px;">
          ${bubblesHtml}
        </div>
        <div class="cluster-tooltip">
          <span>${tooltipText}</span>
        </div>
      </div>
    `,
    iconSize: [totalWidth, totalHeight],
    iconAnchor: [totalWidth / 2, totalHeight / 2],
  })
}


/* =========================================================
   MARKER MANAGEMENT
   ========================================================= */

function updateMarker(point: Point): void {
  if (!map || !markerCluster) {
    return
  }

  const existingMarker = markers.get(point.userId)

  if (existingMarker) {
    ;(existingMarker as any)._userId = point.userId
    existingMarker
      .setLatLng([point.lat, point.lng])
      .setIcon(markerFor(point))

    return
  }


  const newMarker = L.marker(
    [point.lat, point.lng],
    {
      icon: markerFor(point),
    },
  )
  ;(newMarker as any)._userId = point.userId


  newMarker.on('click', () => {
    selectedFriendId.value = point.userId
  })


  markers.set(
    point.userId,
    newMarker,
  )

  markerCluster.addLayer(newMarker)
}


/* =========================================================
   NOTIFICATIONS
   ========================================================= */

function showNotice(text: string): void {
  notice.value = text

  if (noticeTimer) {
    clearTimeout(noticeTimer)
  }

  noticeTimer = setTimeout(() => {
    notice.value = ''
  }, 3500)
}


/* =========================================================
   SOCKET EVENTS
   ========================================================= */

function receiveSnapshot(snapshot: Point[]): void {
  snapshot.forEach((point) => {
    if (stoppedViewing.has(point.userId)) {
      return
    }

    points.set(point.userId, point)

    updateMarker(point)
  })
}


/* =========================================================
   STOP VIEWING
   ========================================================= */

function stopViewing(userId: string): void {
  stoppedViewing.add(userId)

  socket?.emit(
    'view:stop',
    {
      friendId: userId,
    },
  )

  const marker = markers.get(userId)

  if (marker) {
    markerCluster?.removeLayer(marker)
  }

  markers.delete(userId)
  points.delete(userId)

  selectedFriendId.value = null
}


/* =========================================================
   LOCATION HISTORY
   ========================================================= */

async function toggleHistory(): Promise<void> {
  historyVisible.value = !historyVisible.value

  historyError.value = ''


  if (!historyVisible.value) {
    historyLine?.remove()

    historyLine = undefined

    historyPointCount.value = 0

    return
  }


  if (!map) {
    return
  }


  historyLoading.value = true


  try {
    const result = await apiRequest<{
      points: {
        lat: number
        lng: number
      }[]
    }>('/location/history')


    historyPointCount.value =
      result.points.length


    historyLine?.remove()


    if (result.points.length > 1) {
      historyLine = L.polyline(
        result.points.map(
          (point) =>
            [
              point.lat,
              point.lng,
            ] as [number, number],
        ),

        {
          color: '#e56b4f',
          weight: 4,
          opacity: 0.8,
          lineCap: 'round',
          lineJoin: 'round',
        },
      ).addTo(map)


      map.fitBounds(
        historyLine.getBounds(),
        {
          padding: [40, 40],
        },
      )
    }

  } catch (err) {
    historyError.value =
      err instanceof Error
        ? err.message
        : 'Could not load location history'

  } finally {
    historyLoading.value = false
  }
}


/* =========================================================
   LOCATION WATCH
   ========================================================= */

function startLocationWatch(): void {
  if (!navigator.geolocation) {
    showNotice(
      'Geolocation is not available in this browser.',
    )

    return
  }


  watchId =
    navigator.geolocation.watchPosition(

      (position) => {
        const now = Date.now()


        /*
         * Keep the existing 5 second throttle.
         * No need to change backend/data behavior.
         */

        if (
          !socket ||
          now - lastEmitTime < 5_000
        ) {
          return
        }


        lastEmitTime = now


        socket.emit(
          'location:update',
          {
            lat:
              position.coords.latitude,

            lng:
              position.coords.longitude,

            accuracy:
              position.coords.accuracy,

            timestamp: now,
          },
        )
      },


      () => {
        showNotice(
          'Location permission is needed to share your position.',
        )
      },


      {
        enableHighAccuracy: true,

        maximumAge: 10_000,
      },
    )
}


/* =========================================================
   MAP INITIALIZATION
   ========================================================= */

onMounted(async () => {
  try {

    friends.value =
      await apiRequest<Friendship[]>(
        '/friendships',
      )


    if (mapElement.value) {
      map = L.map(
        mapElement.value,
        {
          maxZoom: 19,

          zoomControl: true,

          /*
           * Keeps interactions smooth.
           */

          zoomSnap: 0.5,
        },
      ).setView(
        [34.0, 9.0],
        6.5,
      )
    }


    /*
     * Cluster configuration
     *
     * IMPORTANT:
     *
     * spiderfyOnMaxZoom means users at the
     * exact same location can expand outward.
     *
     * We use the existing MarkerCluster
     * library instead of building custom
     * overlap logic.
     */

    markerCluster =
      L.markerClusterGroup({

        maxClusterRadius: 45,

        iconCreateFunction:
          clusterIcon,


        spiderfyOnMaxZoom: false,

        zoomToBoundsOnClick: false,

        spiderfyOnEveryZoom: false,

        showCoverageOnHover: false,

        animate: true,

        animateAddingMarkers: true,
      })


    function openClusterWhenReady(childMarkers: L.Marker[]): void {
      if (!map || !markerCluster || childMarkers.length === 0) return

      let tries = 0
      const maxTries = 30

      const checkAndOpen = () => {
        if (!map || !markerCluster) return

        /* 1 ▸ if individual markers are already visible on the map, avatars are showing */
        const anyVisible = childMarkers.some(
          (m) => (m as any)._icon && map!.hasLayer(m),
        )
        if (anyVisible) return

        /* 2 ▸ wait until Leaflet.markercluster internal zoom animation is fully finished */
        if ((markerCluster as any)._inZoomAnimation > 0) {
          if (++tries < maxTries) {
            setTimeout(checkAndOpen, 50)
          }
          return
        }

        /* 3 ▸ find visible parent cluster and spiderfy it to show all avatars */
        for (const marker of childMarkers) {
          const parent = (markerCluster as any).getVisibleParent(marker)
          if (
            parent &&
            parent !== marker &&
            typeof parent.spiderfy === 'function'
          ) {
            if ((markerCluster as any)._spiderfied === parent) {
              return
            }
            parent.spiderfy()
            return
          }
        }

        if (++tries < maxTries) {
          setTimeout(checkAndOpen, 50)
        }
      }

      checkAndOpen()
    }


    markerCluster.on('clusterclick', (e: any) => {
      const cluster = e.layer
      const clusterEl = cluster._icon as HTMLElement | undefined
      const childMarkers: L.Marker[] = cluster.getAllChildMarkers()

      /* 1 ▸ play the pop + ripple CSS animation */
      if (clusterEl) {
        clusterEl.classList.add('cluster-pop')
      }

      /* 2 ▸ after pop animation, zoom or spiderfy */
      setTimeout(() => {
        if (!map || !markerCluster) return

        const mapMaxZoom = map.getMaxZoom() || 19
        const currentZoom = map.getZoom()

        /* calculate target zoom */
        const clusterZoom: number = cluster._zoom ?? currentZoom
        let targetZoom = clusterZoom + 1
        const boundsZoom = map.getBoundsZoom(cluster.getBounds())

        let kids = (cluster._childClusters || []).slice()
        while (kids.length > 0 && boundsZoom > targetZoom) {
          targetZoom++
          let next: any[] = []
          for (const c of kids) next = next.concat(c._childClusters || [])
          kids = next
        }

        if (boundsZoom > targetZoom) targetZoom = boundsZoom
        if (targetZoom <= currentZoom) targetZoom = currentZoom + 1
        targetZoom = Math.min(targetZoom, mapMaxZoom)

        /* already at or above target zoom / max zoom → spiderfy immediately */
        if (currentZoom >= targetZoom || currentZoom >= mapMaxZoom - 1) {
          cluster.spiderfy()
          return
        }

        /* smooth fly to target zoom */
        map.flyTo(
          cluster.getLatLng(),
          targetZoom,
          { duration: 0.7 },
        )

        /*
         * 3 ▸ when fly completes, wait for Leaflet.markercluster
         *     animation to settle, then automatically open the avatars
         */
        map.once('moveend', () => {
          openClusterWhenReady(childMarkers)
        })

        /* safety fallback in case moveend doesn't fire */
        setTimeout(() => {
          openClusterWhenReady(childMarkers)
        }, 850)
      }, 350)
    })


    markerCluster.addTo(map!)


    L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        attribution:
          '&copy; OpenStreetMap contributors',

        maxZoom: 19,
      },
    ).addTo(map!)


    /* =====================================================
       SOCKET
       ===================================================== */

    socket = io(
      apiBaseUrl,
      {
        auth: {
          token:
            localStorage.getItem(
              'friendmap_token',
            ),
        },
      },
    )


    socket.on(
      'connect',
      () => {
        connection.value = 'live'

        socket?.emit('view:friends')

        startLocationWatch()
      },
    )


    socket.on(
      'disconnect',
      () => {
        connection.value = 'offline'
      },
    )


    socket.on(
      'location:snapshot',
      receiveSnapshot,
    )


    socket.on(
      'location:update',

      (point: Point) => {
        if (
          stoppedViewing.has(
            point.userId,
          )
        ) {
          return
        }


        points.set(
          point.userId,
          point,
        )

        updateMarker(point)
      },
    )


    socket.on(
      'location:hidden',

      ({
        userId,
      }: {
        userId: string
      }) => {

        const marker =
          markers.get(userId)


        if (marker) {
          markerCluster?.removeLayer(
            marker,
          )
        }


        markers.delete(userId)

        points.delete(userId)


        if (
          selectedFriendId.value ===
          userId
        ) {
          selectedFriendId.value =
            null
        }


        showNotice(
          `${usernameFor(userId)} is no longer sharing their location.`,
        )
      },
    )


    socket.on(
      'location:rejected',

      ({
        reason,
      }: {
        reason: string
      }) => {

        showNotice(
          `Location update rejected: ${reason}`,
        )
      },
    )


    /*
     * Refresh relative times.
     *
     * Example:
     *
     * "just now"
     * ->
     * "15s ago"
     * ->
     * "1m ago"
     */

    clock = setInterval(
      () => {

        markers.forEach(
          (marker, userId) => {

            const point =
              points.get(userId)


            if (point) {
              marker.setIcon(
                markerFor(point),
              )
            }
          },
        )
      },

      15_000,
    )


  } catch (err) {

    showNotice(
      err instanceof Error
        ? err.message
        : 'Could not load friends',
    )
  }
})


/* =========================================================
   CLEANUP
   ========================================================= */

onBeforeUnmount(() => {

  if (watchId !== undefined) {
    navigator.geolocation.clearWatch(
      watchId,
    )
  }


  if (clock) {
    clearInterval(clock)
  }


  if (noticeTimer) {
    clearTimeout(noticeTimer)
  }


  socket?.disconnect()


  historyLine?.remove()


  map?.remove()
})
</script>


<template>

  <section class="map-page">

    <!-- ===============================================
         MAP HEADER
         =============================================== -->

    <div class="map-toolbar">

      <div class="map-title-card">

        <p class="eyebrow">
          LIVE VIEW
        </p>

        <h1>
          Friend map
        </h1>


        <div class="map-title-bottom">

          <span class="status">

            <i :class="connection"></i>

            {{ connection }}

          </span>

        </div>

      </div>


      <div class="map-actions">

        <button
          class="button secondary history-toggle"
          type="button"
          @click="toggleHistory"
        >

          {{
            historyVisible
              ? 'Hide history'
              : 'My history'
          }}

        </button>

      </div>

    </div>


    <!-- ===============================================
         MAP
         =============================================== -->

    <div
      ref="mapElement"
      class="map-canvas"
    ></div>


    <!-- ===============================================
         NOTIFICATION
         =============================================== -->

    <div
      v-if="notice"
      class="toast"
    >

      {{ notice }}

    </div>


    <!-- ===============================================
         HISTORY STATUS
         =============================================== -->

    <div
      v-if="
        historyVisible &&
        historyLoading
      "
      class="history-status"
    >

      Loading history...

    </div>


    <div
      v-if="
        historyVisible &&
        !historyLoading &&
        historyError
      "
      class="history-status error"
    >

      {{ historyError }}

    </div>


    <div
      v-if="
        historyVisible &&
        !historyLoading &&
        !historyError &&
        historyPointCount < 2
      "
      class="history-status"
    >

      No trail available yet.

    </div>


    <!-- ===============================================
         LEGEND
         =============================================== -->

    <div class="map-legend">

      <span class="legend-item">

        <i class="legend-dot"></i>

        Live location

      </span>


      <span class="legend-item">

        <i
          class="
            legend-dot
            stale-dot
          "
        ></i>

        Stale

      </span>

    </div>


    <!-- ===============================================
         SELECTED FRIEND CARD

         Replaces the old modal.
         The map remains visible.
         =============================================== -->

    <div
      v-if="selectedFriendId"
      class="friend-map-card"
    >

      <div class="friend-card-header">


        <div class="friend-card-avatar">

          {{
            getInitial(
              selectedFriendId,
            )
          }}

        </div>


        <div class="friend-card-info">

          <h3>

            {{
              usernameFor(
                selectedFriendId,
              )
            }}

          </h3>


          <p
            v-if="
              points.get(
                selectedFriendId,
              )
            "
            class="friend-card-time"
          >

            Updated

            {{
              formatRelativeTime(
                points.get(
                  selectedFriendId,
                )!.updatedAt,
              )
            }}

          </p>


          <span class="friend-card-live">

            <i></i>

            Location shared

          </span>

        </div>


        <button
          class="friend-card-close"
          type="button"
          aria-label="Close friend details"
          @click="
            selectedFriendId = null
          "
        >

          ×

        </button>

      </div>


      <div class="friend-card-actions">

        <button
          class="button primary"
          type="button"
          @click="
            stopViewing(
              selectedFriendId!,
            )
          "
        >

          Stop viewing

        </button>

      </div>

    </div>


  </section>

</template>