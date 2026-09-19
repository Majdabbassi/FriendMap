<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import { io, type Socket } from 'socket.io-client'
import {
  apiBaseUrl,
  apiRequest,
  createTrip,
  getAccessToken,
  getTrip,
  listTrips,
  type Friendship,
  type TripDetail,
  type TripListItem,
} from '../api'
import { usePresenceStore } from '../stores/presence'
import { useAuthStore } from '../stores/auth'
import { formatDistanceKm, haversineKm } from '../utils/distance'

type Point = {
  userId: string
  lat: number
  lng: number
  accuracy?: number
  updatedAt: number
}

type TripPoint = {
  userId: string
  lat: number
  lng: number
  updatedAt: number
}

type MarkerClusterInternal = {
  _zoom?: number
  _childClusters?: L.MarkerCluster[]
}

type MarkerClusterGroupInternal = {
  _inZoomAnimation: number
  _spiderfied: L.MarkerCluster | null
}

function markerClusterInternal(cluster: L.MarkerCluster): L.MarkerCluster & MarkerClusterInternal {
  return cluster as L.MarkerCluster & MarkerClusterInternal
}

function clusterGroupInternal(group: L.MarkerClusterGroup): L.MarkerClusterGroup & MarkerClusterGroupInternal {
  return group as L.MarkerClusterGroup & MarkerClusterGroupInternal
}

const mapElement = ref<HTMLElement | null>(null)
const presence = usePresenceStore()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const notice = ref('')
const connection = ref('connecting')

const historyVisible = ref(false)
const historyLoading = ref(false)
const historyError = ref('')
const historyPointCount = ref(0)

const friends = ref<Friendship[]>([])
const selectedFriendId = ref<string | null>(null)

const friendSearch = ref('')
const friendSearchOpen = ref(false)
const ownPoint = ref<{ lat: number; lng: number } | null>(null)
const compareOpen = ref(false)
const compareWithId = ref<string | null>(null)
const distanceResult = ref<{
  aName: string
  bName: string
  km: number
} | null>(null)
const tripCreating = ref(false)

const trips = ref<TripListItem[]>([])
const tripPanelOpen = ref(false)
const tripsLoading = ref(false)
const activeTripId = ref<string | null>(null)
const activeTrip = ref<TripDetail | null>(null)

const tripMemberPoints = new Map<string, TripPoint>()
const tripMemberMarkers = new Map<string, L.Marker>()
let tripMeetupMarker: L.Marker | undefined
let tripProposalMarker: L.Marker | undefined
let tripFitDone = false

const points = new Map<string, Point>()
const markers = new Map<string, L.Marker>()
const stoppedViewing = new Set<string>()
const stoppedFriends = ref<string[]>([])
const markerUserIds = new WeakMap<L.Marker, string>()

let map: L.Map | undefined
let markerCluster: L.MarkerClusterGroup | undefined
let socket: Socket | undefined

let watchId: number | undefined
let lastEmitTime = 0

let noticeTimer: ReturnType<typeof setTimeout> | undefined
let clock: ReturnType<typeof setInterval> | undefined

let historyLine: L.Polyline | undefined
let distanceLine: L.Polyline | undefined


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
  return FRIEND_COLORS[hash % FRIEND_COLORS.length]!
}

function userIdForMarker(marker: L.Marker): string | undefined {
  const stored = markerUserIds.get(marker)
  if (stored) return stored
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
   FIND A FRIEND
   ========================================================= */

const findableFriends = computed(() => {
  const q = friendSearch.value.trim().toLowerCase()
  if (!q) return friends.value
  return friends.value.filter(
    (item) =>
      item.friend.username.toLowerCase().includes(q) ||
      item.friend.email.toLowerCase().includes(q),
  )
})

function selectSearchResult(friendId: string): void {
  friendSearch.value = ''
  friendSearchOpen.value = false
  selectedFriendId.value = friendId

  const point = points.get(friendId)
  if (point && map) {
    map.flyTo([point.lat, point.lng], Math.max(map.getZoom(), 12), {
      duration: 0.7,
    })
  } else {
    showNotice(`${usernameFor(friendId)} is not sharing their location.`)
  }
}


/* =========================================================
   DISTANCE
   ========================================================= */

function clearMeasure(): void {
  distanceLine?.remove()
  distanceLine = undefined
  compareOpen.value = false
  compareWithId.value = null
  distanceResult.value = null
}

function drawDistanceLine(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): void {
  if (!map) return
  distanceLine?.remove()
  distanceLine = L.polyline(
    [
      [a.lat, a.lng],
      [b.lat, b.lng],
    ] as [number, number][],
    {
      color: '#1b877a',
      weight: 3,
      dashArray: '8 8',
      opacity: 0.9,
    },
  ).addTo(map)
}

function distanceToMe(): void {
  const friendId = selectedFriendId.value!
  const peer = points.get(friendId)
  if (!ownPoint.value || !peer) {
    showNotice(
      'Both you and your friend need to be sharing your locations.',
    )
    return
  }
  const km = haversineKm(
    ownPoint.value.lat,
    ownPoint.value.lng,
    peer.lat,
    peer.lng,
  )
  distanceResult.value = {
    aName: 'You',
    bName: usernameFor(friendId),
    km,
  }
  drawDistanceLine(ownPoint.value, peer)
}

function compareWith(friendId: string): void {
  compareOpen.value = false
  const a = points.get(selectedFriendId.value!)
  const b = points.get(friendId)
  if (!a || !b) {
    showNotice('Both friends need to be sharing their locations.')
    return
  }
  const km = haversineKm(a.lat, a.lng, b.lat, b.lng)
  distanceResult.value = {
    aName: usernameFor(selectedFriendId.value!),
    bName: usernameFor(friendId),
    km,
  }
  compareWithId.value = friendId
  drawDistanceLine(a, b)
}


/* =========================================================
   MEET UP & TRIPS SHORTCUT
   ========================================================= */

async function meetUpWith(friendId: string): Promise<void> {
  const name = `Meet up with ${usernameFor(friendId)}`
  tripCreating.value = true
  try {
    const { trip } = await createTrip({ name, memberIds: [friendId] })
    showNotice('Trip created — meet in the middle!')
    await router.push(`/trips/${trip.id}`)
  } catch (err) {
    showNotice(
      err instanceof Error ? err.message : 'Sorry, the trip could not be created',
    )
  } finally {
    tripCreating.value = false
  }
}

function goToTrips(): void {
  void router.push('/trips')
}


/* =========================================================
   TRIP LAYER
   ========================================================= */

function tripStatusLabel(trip: TripListItem | TripDetail | null): string {
  if (!trip) return ''
  return trip.status === 'DRAFT'
    ? 'Organizing'
    : trip.status === 'DECIDED'
      ? 'Go time'
      : 'Archived'
}

const tripArrivalCount = computed(
  () =>
    activeTrip.value?.members.filter((member) => member.arrivedAt != null)
      .length ?? 0,
)

const tripOnlineCount = computed(
  () =>
    activeTrip.value?.members.filter((member) => presence.isOnline(member.userId))
      .length ?? 0,
)

function tripUsername(userId: string): string {
  if (userId === auth.userId) return 'You'
  return (
    activeTrip.value?.members.find((m) => m.userId === userId)?.user?.username ??
    friends.value.find((f) => f.friend.id === userId)?.friend.username ??
    'Friend'
  )
}

function tripMemberIds(): Set<string> {
  return new Set(activeTrip.value?.members.map((m) => m.userId) ?? [])
}

function tripMedianPoint(): { lat: number; lng: number; count: number } | null {
  const live = [...tripMemberPoints.values()].filter((p) => p.lat && p.lng)
  if (live.length === 0) return null
  const lat = live.reduce((sum, p) => sum + p.lat, 0) / live.length
  const lng = live.reduce((sum, p) => sum + p.lng, 0) / live.length
  return { lat, lng, count: live.length }
}

function tripMeetupPoint(): {
  lat: number
  lng: number
  name: string
  setBy: string | null
} | null {
  const t = activeTrip.value
  if (!t) return null
  if (t.meetupMode === 'FIXED' && t.meetupLat != null && t.meetupLng != null) {
    return {
      lat: t.meetupLat,
      lng: t.meetupLng,
      name: t.meetupName ?? 'Meetup spot',
      setBy: t.meetupFixedById ? tripUsername(t.meetupFixedById) : null,
    }
  }
  const median = tripMedianPoint()
  if (!median) return null
  return { lat: median.lat, lng: median.lng, name: 'Meet in the middle', setBy: null }
}

function tripProposalPoint(): {
  lat: number
  lng: number
  name: string
  by: string
} | null {
  const t = activeTrip.value
  if (
    !t?.meetupProposalById ||
    t.meetupProposalLat == null ||
    t.meetupProposalLng == null
  ) {
    return null
  }
  return {
    lat: t.meetupProposalLat,
    lng: t.meetupProposalLng,
    name: t.meetupProposalName ?? 'New spot',
    by: tripUsername(t.meetupProposalById),
  }
}

function tripMeetupIcon(translucent = false): L.DivIcon {
  const isFixed = activeTrip.value?.meetupMode === 'FIXED'
  const bg = translucent
    ? isFixed
      ? '#c75034'
      : '#257a66'
    : isFixed
      ? '#e56b4f'
      : '#1b877a'
  return L.divIcon({
    className: 'map-trip-meetup',
    html: `<div class="trip-pin" style="background:${bg}">
      <div class="trip-pin-inner">M</div>
      <div class="trip-pin-tip"></div>
    </div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  })
}

function tripMemberIcon(userId: string): L.DivIcon {
  const arrived = Boolean(
    activeTrip.value?.members.find((m) => m.userId === userId)?.arrivedAt,
  )
  return L.divIcon({
    className: 'map-trip-member-marker',
    html: `<div class="trip-member-dot${arrived ? ' arrived' : ''}" style="background:${colorForUser(userId)}">
      <span>${getInitial(userId)}</span>
    </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })
}

function drawTripLayer(): void {
  if (!map) return
  tripMemberMarkers.forEach((marker) => marker.remove())
  tripMemberMarkers.clear()
  tripMeetupMarker?.remove()
  tripMeetupMarker = undefined
  tripProposalMarker?.remove()
  tripProposalMarker = undefined

  const meetup = tripMeetupPoint()
  if (meetup) {
    tripMeetupMarker = L.marker([meetup.lat, meetup.lng], { icon: tripMeetupIcon() }).addTo(map)
    tripMeetupMarker.bindTooltip(
      meetup.setBy
        ? `${meetup.name} · set by ${meetup.setBy}`
        : `${meetup.name} · estimated from ${tripMedianPoint()?.count ?? 0}`,
      { direction: 'top', offset: [0, -20] },
    )
  }

  const proposal = tripProposalPoint()
  if (proposal) {
    tripProposalMarker = L.marker([proposal.lat, proposal.lng], {
      icon: tripMeetupIcon(true),
    }).addTo(map)
    tripProposalMarker.bindTooltip(`${proposal.name} · proposed by ${proposal.by}`, {
      direction: 'top',
      offset: [0, -20],
    })
  }

  for (const point of tripMemberPoints.values()) {
    const marker = L.marker([point.lat, point.lng], {
      icon: tripMemberIcon(point.userId),
    }).addTo(map)
    marker.bindTooltip(tripUsername(point.userId), {
      direction: 'top',
      offset: [0, -16],
    })
    tripMemberMarkers.set(point.userId, marker)
  }

  if (!tripFitDone) {
    tripFitDone = true
    fitTripBounds()
  }
}

function fitTripBounds(): void {
  if (!map) return
  const points: [number, number][] = []
  const meetup = tripMeetupPoint()
  if (meetup) points.push([meetup.lat, meetup.lng])
  const proposal = tripProposalPoint()
  if (proposal) points.push([proposal.lat, proposal.lng])
  for (const point of tripMemberPoints.values()) {
    points.push([point.lat, point.lng])
  }
  if (points.length === 0) return
  map.fitBounds(L.latLngBounds(points), {
    padding: [54, 54],
    maxZoom: 15,
  })
}

function clearTripLayer(): void {
  if (activeTripId.value) {
    socket?.emit('trip:leave', { tripId: activeTripId.value })
  }
  tripMemberPoints.clear()
  tripMemberMarkers.forEach((marker) => marker.remove())
  tripMemberMarkers.clear()
  tripMeetupMarker?.remove()
  tripMeetupMarker = undefined
  tripProposalMarker?.remove()
  tripProposalMarker = undefined
  activeTrip.value = null
  activeTripId.value = null
  tripFitDone = false
}

async function activateTrip(tripId: string | null): Promise<void> {
  if (tripId && tripId === activeTripId.value) return
  clearTripLayer()
  if (!tripId) return
  activeTripId.value = tripId
  try {
    activeTrip.value = await getTrip(tripId)
    socket?.emit('trip:join', { tripId })
    drawTripLayer()
  } catch (err) {
    showNotice(err instanceof Error ? err.message : 'Could not load the trip')
    activeTripId.value = null
  }
}

async function refreshActiveTrip(): Promise<void> {
  if (!activeTripId.value) return
  try {
    activeTrip.value = await getTrip(activeTripId.value)
    drawTripLayer()
  } catch {
    // Keep the last known copy if the fetch fails.
  }
}

function openActiveTrip(): void {
  if (!activeTripId.value) return
  void router.push(`/trips/${activeTripId.value}`)
}

async function toggleTripPanel(): Promise<void> {
  tripPanelOpen.value = !tripPanelOpen.value
  if (tripPanelOpen.value && trips.value.length === 0) {
    tripsLoading.value = true
    try {
      trips.value = await listTrips()
    } catch {
      trips.value = []
    } finally {
      tripsLoading.value = false
    }
  }
}

function selectTripRow(tripId: string): void {
  if (activeTripId.value === tripId) {
    void activateTrip(null)
  } else {
    void activateTrip(tripId)
  }
}

function handleTripPoint(point: TripPoint): void {
  if (!activeTripId.value) return
  if (!tripMemberIds().has(point.userId)) return
  tripMemberPoints.set(point.userId, point)
  const existing = tripMemberMarkers.get(point.userId)
  if (existing) {
    existing.setLatLng([point.lat, point.lng])
    existing.setIcon(tripMemberIcon(point.userId))
    return
  }
  const marker = L.marker([point.lat, point.lng], {
    icon: tripMemberIcon(point.userId),
  }).addTo(map!)
  marker.bindTooltip(tripUsername(point.userId), { direction: 'top', offset: [0, -16] })
  tripMemberMarkers.set(point.userId, marker)
}

function handleTripHidden(userId: string): void {
  if (!tripMemberPoints.has(userId)) return
  tripMemberPoints.delete(userId)
  const marker = tripMemberMarkers.get(userId)
  if (marker && map) {
    map.removeLayer(marker)
    tripMemberMarkers.delete(userId)
  }
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
    const uid = userIdForMarker(m)
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
  const first = friendsInfo[0]!
  const second = friendsInfo[1]!
  const third = friendsInfo[2]!

  let tooltipText = ''
  if (friendsInfo.length >= 3) {
    if (count === 3) {
      tooltipText = `${first.name}, ${second.name} & ${third.name}`
    } else {
      const more = count - 3
      tooltipText = `${first.name}, ${second.name}, ${third.name} +${more} more`
    }
  } else if (friendsInfo.length === 2) {
    tooltipText = count > 2 ? `${first.name}, ${second.name} +${count - 2}` : `${first.name} & ${second.name}`
  } else if (friendsInfo.length === 1) {
    tooltipText = count > 1 ? `${first.name} & ${count - 1} other` : first.name
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
  markerUserIds.set(newMarker, point.userId)


  newMarker.on('click', () => {
    clearMeasure()
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

  if (activeTripId.value) {
    snapshot.forEach((point) => handleTripPoint(point))
  }
}


/* =========================================================
   STOP VIEWING
   ========================================================= */

function stopViewing(userId: string): void {
  stoppedViewing.add(userId)

  if (selectedFriendId.value === userId) {
    clearMeasure()
  }

  if (!stoppedFriends.value.includes(userId)) {
    stoppedFriends.value.push(userId)
  }

  socket?.emit(
    'view:stop',
    {
      friendId: userId,
    },
  )

  const marker = markers.get(userId)

  if (marker) {
    markerCluster?.removeLayer(marker)
    markerUserIds.delete(marker)
  }

  markers.delete(userId)
  points.delete(userId)

  selectedFriendId.value = null
}


/* =========================================================
   RESUME VIEWING
   ========================================================= */

function resumeViewing(userId: string): void {
  stoppedViewing.delete(userId)

  stoppedFriends.value = stoppedFriends.value.filter(
    (friendId) => friendId !== userId,
  )

  socket?.emit(
    'view:start',
    {
      friendId: userId,
    },
  )
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

        ownPoint.value = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }

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
          (m) => m.getElement() !== undefined && map!.hasLayer(m),
        )
        if (anyVisible) return

        /* 2 ▸ wait until Leaflet.markercluster internal zoom animation is fully finished */
        if (clusterGroupInternal(markerCluster)._inZoomAnimation > 0) {
          if (++tries < maxTries) {
            setTimeout(checkAndOpen, 50)
          }
          return
        }

        /* 3 ▸ find visible parent cluster and spiderfy it to show all avatars */
        for (const marker of childMarkers) {
          const parent = markerCluster.getVisibleParent(marker)
          if (parent && parent !== marker && parent instanceof L.MarkerCluster) {
            if (clusterGroupInternal(markerCluster)._spiderfied === parent) {
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


    markerCluster.on('clusterclick', (event: L.LeafletEvent) => {
      const cluster = (event as unknown as { layer: L.MarkerCluster }).layer
      const clusterEl = cluster.getElement()
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
        const clusterZoom: number = markerClusterInternal(cluster)._zoom ?? currentZoom
        let targetZoom = clusterZoom + 1
        const boundsZoom = map.getBoundsZoom(cluster.getBounds())

        let kids = (markerClusterInternal(cluster)._childClusters ?? []).slice()
        while (kids.length > 0 && boundsZoom > targetZoom) {
          targetZoom++
          const next: L.MarkerCluster[] = []
          for (const c of kids) {
            const childClusters = markerClusterInternal(c)._childClusters
            if (childClusters) next.push(...childClusters)
          }
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
        auth: (cb: (data: object) => void) =>
          cb({ token: getAccessToken() }),
      },
    )


    socket.on(
      'connect',
      () => {
        connection.value = 'live'

        socket?.emit('view:friends')

        socket?.emit('presence:snapshot')

        if (activeTripId.value) {
          socket?.emit('trip:join', { tripId: activeTripId.value })
        }

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
          if (activeTripId.value) {
            handleTripPoint(point)
          }
          return
        }


        points.set(
          point.userId,
          point,
        )

        updateMarker(point)

        if (activeTripId.value) {
          handleTripPoint(point)
        }
      },
    )


    socket.on(
      'location:hidden',

      ({
        userId,
      }: {
        userId: string
      }) => {

        handleTripHidden(userId)

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


    socket.on(
      'trip:joined',

      (data: {
        memberLocations: TripPoint[]
      }) => {

        if (!activeTripId.value) return

        tripMemberPoints.clear()

        for (const point of data.memberLocations ?? []) {
          if (tripMemberIds().has(point.userId)) {
            tripMemberPoints.set(point.userId, point)
          }
        }

        drawTripLayer()
      },
    )


    socket.on(
      'trip:update',
      () => {
        if (activeTripId.value) {
          void refreshActiveTrip()
        }
      },
    )


    socket.on(
      'trip:member-arrived',

      ({
        userId,
        arrivedAt,
      }: {
        userId: string
        arrivedAt: string | null
      }) => {

        if (!activeTrip.value) return

        activeTrip.value.members = activeTrip.value.members.map(
          (member) =>
            member.userId === userId
              ? { ...member, arrivedAt }
              : member,
        )

        const marker = tripMemberMarkers.get(userId)

        if (marker) {
          marker.setIcon(
            tripMemberIcon(userId),
          )
        }
      },
    )


    socket.on(
      'trip:error',
      ({ message }: { message: string }) => {
        showNotice(message)
      },
    )


    socket.on(
      'presence:update',

      (update: {
        userId: string
        online: boolean
        lastSeen: string
      }) => {

        if (update.online) {
          presence.setOnline(update.userId)
        } else {
          presence.setLastSeen(update.userId, Number(update.lastSeen))
          presence.setOffline(update.userId)
        }
      },
    )


    socket.on(
      'presence:snapshot',

      (snapshot: {
        onlineUserIds: string[]
        lastSeenByUserId?: Record<string, number>
      }) => {

        presence.applySnapshot(
          snapshot.onlineUserIds,
          snapshot.lastSeenByUserId,
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

  const requestedTrip =
    typeof route.query.trip === 'string'
      ? route.query.trip
      : null

  if (requestedTrip) {
    void activateTrip(requestedTrip).then(() => {
      router.replace({ path: '/map' })
    })
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


  if (activeTripId.value) {
    socket?.emit('trip:leave', { tripId: activeTripId.value })
  }

  socket?.disconnect()


  historyLine?.remove()

  clearMeasure()


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


      <div class="map-find">
        <input
          v-model="friendSearch"
          type="text"
          placeholder="Find a friend…"
          autocomplete="off"
          @focus="friendSearchOpen = true"
          @keydown.esc="friendSearchOpen = false"
        />
        <div
          v-if="friendSearchOpen && friendSearch.trim()"
          class="map-find-list"
        >
          <div
            v-for="item in findableFriends"
            :key="item.friend.id"
            class="map-find-row"
            role="button"
            tabindex="0"
            @click="selectSearchResult(item.friend.id)"
            @keydown.enter="selectSearchResult(item.friend.id)"
          >
            <span class="map-find-avatar">
              {{ item.friend.username.charAt(0).toUpperCase() }}
            </span>
            <span class="map-find-name">{{ item.friend.username }}</span>
            <span
              class="map-find-state"
              :class="points.has(item.friend.id) ? 'sharing' : 'hidden'"
            >
              {{ points.has(item.friend.id) ? 'On the map' : 'Location hidden' }}
            </span>
          </div>
        </div>
      </div>


      <div class="map-actions">

        <button
          class="button secondary"
          type="button"
          @click="goToTrips"
        >
          Trips
        </button>

        <button
          class="button secondary"
          :class="{ active: tripPanelOpen }"
          type="button"
          @click="toggleTripPanel"
        >
          Trip layer
        </button>

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
         TRIP LAYER PANEL
         =============================================== -->

    <div
      v-if="tripPanelOpen"
      class="map-trip-panel"
    >
      <div class="map-trip-panel-head">
        <span>Trips on the map</span>
        <button
          class="friend-card-close"
          type="button"
          aria-label="Close trip layer panel"
          @click="tripPanelOpen = false"
        >
          ×
        </button>
      </div>

      <div
        v-if="tripsLoading"
        class="map-trip-panel-hint"
      >
        Loading…
      </div>

      <div
        v-else-if="trips.length === 0"
        class="map-trip-panel-hint"
      >
        No trips yet — plan one on the Trips page.
      </div>

      <div v-else class="map-trip-list">
        <div
          v-for="trip in trips"
          :key="trip.id"
          class="map-trip-row"
          :class="{ active: activeTripId === trip.id }"
          role="button"
          tabindex="0"
          @click="selectTripRow(trip.id)"
          @keydown.enter="selectTripRow(trip.id)"
        >
          <span
            class="map-trip-dot"
            :class="trip.status.toLowerCase()"
          ></span>
          <span class="map-trip-row-name">{{ trip.name }}</span>
          <span class="map-trip-row-state">
            {{
              activeTripId === trip.id
                ? 'On map'
                : trip.status === 'ARCHIVED'
                  ? 'Archived'
                  : 'Show'
            }}
          </span>
        </div>
      </div>
    </div>


    <!-- ===============================================
         ACTIVE TRIP BANNER
         =============================================== -->

    <div
      v-if="activeTrip"
      class="map-trip-banner"
    >
      <div class="map-trip-banner-title">
        <span class="map-trip-banner-dot"></span>
        <p class="map-trip-banner-name">{{ activeTrip.name }}</p>
        <span
          class="trip-status-chip"
          :class="activeTrip.status.toLowerCase()"
        >
          {{ tripStatusLabel(activeTrip) }}
        </span>
      </div>
      <p class="map-trip-banner-sub">
        {{
          activeTrip.meetupMode === 'AUTO'
            ? 'Meet in the middle'
            : activeTrip.meetupName ?? 'Meetup spot'
        }}
        &middot; {{ tripArrivalCount }} arrived &middot;
        {{ tripOnlineCount }} online
      </p>
      <div class="map-trip-banner-actions">
        <button
          class="button subtle small"
          type="button"
          @click="openActiveTrip"
        >
          Open trip
        </button>
        <button
          class="button subtle small"
          type="button"
          @click="selectTripRow(activeTripId!)"
        >
          Remove
        </button>
      </div>
    </div>


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


          <span
            class="friend-presence"
            :class="
              presence.isOnline(
                selectedFriendId,
              )
                ? 'online'
                : 'offline'
            "
          >

            <i></i>

            {{
              presence.isOnline(
                selectedFriendId,
              )
                ? 'Online'
                : 'Offline'
            }}

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
          v-if="stoppedFriends.includes(selectedFriendId!)"
          class="button secondary"
          type="button"
          @click="
            resumeViewing(
              selectedFriendId!,
            )
          "
        >

          Resume viewing

        </button>

        <button
          v-else
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


      <div v-if="distanceResult" class="friend-distance">
        <strong>
          {{ distanceResult.aName }} ↔ {{ distanceResult.bName }}
        </strong>
        <span>
          {{ formatDistanceKm(distanceResult.km) }}
        </span>
        <button
          class="friend-card-close"
          type="button"
          aria-label="Clear distance"
          @click="clearMeasure"
        >
          ×
        </button>
      </div>


      <div class="friend-card-actions secondary-actions">

        <button
          class="button subtle small"
          type="button"
          :disabled="!points.has(selectedFriendId!)"
          title="Distance from your current position"
          @click="distanceToMe"
        >

          Distance to me

        </button>

        <button
          class="button subtle small"
          type="button"
          :disabled="!points.has(selectedFriendId!)"
          @click="compareOpen = true"
        >

          Compare with…

        </button>

        <button
          class="button subtle small"
          type="button"
          :disabled="tripCreating"
          @click="meetUpWith(selectedFriendId!)"
        >

          {{ tripCreating ? 'Creating…' : 'Meet up with…' }}

        </button>

      </div>


      <div v-if="compareOpen" class="friend-compare">
        <p class="friend-compare-title">Compare distances</p>
        <div
          v-for="(item, index) in friends"
          :key="item.id"
          class="friend-compare-row"
          :class="{ muted: !points.has(item.friend.id) }"
          role="button"
          tabindex="0"
          @click="
            item.friend.id !== selectedFriendId &&
              compareWith(item.friend.id)
          "
          @keydown.enter="
            item.friend.id !== selectedFriendId &&
              compareWith(item.friend.id)
          "
        >
          <span class="map-find-avatar">
            {{ item.friend.username.charAt(0).toUpperCase() }}
          </span>
          <span class="map-find-name">{{ item.friend.username }}</span>
          <span v-if="index >= 0" class="map-find-state">
            {{ points.has(item.friend.id) ? 'On the map' : 'Location hidden' }}
          </span>
          <span v-if="item.friend.id === selectedFriendId" class="compare-self">
            (self)
          </span>
        </div>
      </div>

    </div>


    <!-- ===============================================
         HIDDEN FRIENDS (STOPPED VIEWING)
         =============================================== -->

    <div
      v-if="stoppedFriends.length > 0"
      class="stopped-friends"
    >

      <h4>Hidden</h4>

      <div
        v-for="friendId in stoppedFriends"
        :key="friendId"
        class="stopped-friend"
      >

        <span class="stopped-friend-name">
          {{ usernameFor(friendId) }}
        </span>

        <button
          class="button subtle"
          type="button"
          @click="
            resumeViewing(friendId)
          "
        >

          Resume viewing

        </button>

      </div>

    </div>


  </section>

</template>