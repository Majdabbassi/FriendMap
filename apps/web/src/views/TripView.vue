<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { io, type Socket } from 'socket.io-client'
import {
  apiBaseUrl,
  apiRequest,
  arriveAtTrip,
  archiveTrip,
  deleteTrip,
  getAccessToken,
  getTrip,
  getTripMessages,
  inviteToTrip,
  leaveTrip,
  respondToMeetupProposal,
  setTripMeetup,
  updateTrip,
  type Friendship,
  type TripDetail,
  type TripMessage,
} from '../api'
import { useAuthStore } from '../stores/auth'
import { usePresenceStore } from '../stores/presence'
import { formatDistanceKm, haversineKm } from '../utils/distance'

type TripPoint = { userId: string; lat: number; lng: number; updatedAt: number }

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const presence = usePresenceStore()

const tripId = computed(() => String(route.params.id ?? ''))

const trip = ref<TripDetail | null>(null)
const messages = ref<TripMessage[]>([])
const friends = ref<Friendship[]>([])
const notice = ref('')
const draft = ref('')
const sending = ref(false)
const loading = ref(true)
const loadError = ref('')

const memberPoints = ref(new Map<string, TripPoint>())
const typingMemberIds = ref(new Set<string>())

const pickingSpot = ref(false)
const spotDraft = ref<{ lat: number; lng: number } | null>(null)
const inviteModalOpen = ref(false)
const selectedInviteIds = ref<string[]>([])

const mapElement = ref<HTMLElement | null>(null)
const threadEl = ref<HTMLElement | null>(null)

let map: L.Map | undefined
const meetupMarker = ref<L.Marker | null>(null)
const proposalMarker = ref<L.Marker | null>(null)
const memberMarkerMap = new Map<string, L.Marker>()

let socket: Socket | undefined
let noticeTimer: ReturnType<typeof setTimeout> | undefined
let typingEmitTimer: ReturnType<typeof setTimeout> | undefined


/* =========================================================
   USER HELPERS
   ========================================================= */

function usernameFor(userId: string): string {
  if (userId === auth.userId) return 'You'
  return (
    trip.value?.members.find((m) => m.userId === userId)?.user?.username ??
    friends.value.find((f) => f.friend.id === userId)?.friend.username ??
    'Friend'
  )
}

function initialFor(userId: string): string {
  return usernameFor(userId).charAt(0).toUpperCase()
}

const FRIEND_COLORS = [
  '#e56b4f',
  '#257a66',
  '#3b6fd4',
  '#d9822b',
  '#7a52b3',
  '#d44a78',
  '#1b877a',
  '#c75034',
]

function colorForUser(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0
  }
  return FRIEND_COLORS[hash % FRIEND_COLORS.length]!
}

function formatMeetingTime(value: string | null): string {
  if (!value) return ''
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatChatTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function lastSeenText(stamp: number | null | undefined): string {
  if (!stamp) return ''
  const diff = Date.now() - stamp
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

const typingNames = computed(() => {
  const names = [...typingMemberIds.value]
    .map((id) => usernameFor(id))
    .filter((name) => name !== 'You')
  if (names.length === 0) return ''
  return names.length === 1
    ? `${names[0]} is typing…`
    : `${names.slice(0, 2).join(', ')} are typing…`
})


/* =========================================================
   TRIP DERIVED STATE
   ========================================================= */

const myMembership = computed(() =>
  trip.value?.members.find((m) => m.userId === auth.userId),
)

const isAdmin = computed(() => myMembership.value?.role === 'ADMIN')

const meArrived = computed(() => Boolean(myMembership.value?.arrivedAt))

const meetingTimeInput = ref('')

const medianPoint = computed(() => {
  const live = [...memberPoints.value.values()].filter((p) => p.lat && p.lng)
  if (live.length === 0) return null
  const lat = live.reduce((sum, p) => sum + p.lat, 0) / live.length
  const lng = live.reduce((sum, p) => sum + p.lng, 0) / live.length
  return { lat, lng, count: live.length }
})

const meetupPoint = computed<{
  lat: number
  lng: number
  name: string
  setBy: string | null
} | null>(() => {
  const t = trip.value
  if (!t) return null
  if (t.meetupMode === 'FIXED' && t.meetupLat != null && t.meetupLng != null) {
    return {
      lat: t.meetupLat,
      lng: t.meetupLng,
      name: t.meetupName ?? 'Meetup spot',
      setBy: t.meetupFixedById ? usernameFor(t.meetupFixedById) : null,
    }
  }
  const median = medianPoint.value
  if (!median) return null
  return {
    lat: median.lat,
    lng: median.lng,
    name: 'Meet in the middle',
    setBy: null,
  }
})

const hasLiveMemberLocations = computed(() => medianPoint.value !== null)

const proposalPoint = computed(() => {
  const t = trip.value
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
    by: usernameFor(t.meetupProposalById),
  }
})

const canProposeSpot = computed(() => {
  if (!trip.value) return false
  return (
    trip.value.status !== 'ARCHIVED' &&
    trip.value.status === 'DECIDED' &&
    !proposalPoint.value
  )
})

const participants = computed(() => {
  if (!trip.value) return []
  return trip.value.members.map((member) => {
    const point = memberPoints.value.get(member.userId)
    let distance: number | null = null
    if (point && meetupPoint.value) {
      distance = haversineKm(
        point.lat,
        point.lng,
        meetupPoint.value.lat,
        meetupPoint.value.lng,
      )
    }
    return {
      ...member,
      username: usernameFor(member.userId),
      online: presence.isOnline(member.userId),
      sharing: Boolean(point),
      distance,
      arrived: member.arrivedAt != null,
    }
  })
})

const invitableFriends = computed(() => {
  const memberIds = new Set(trip.value?.members.map((m) => m.userId) ?? [])
  const invitedIds = new Set(trip.value?.invites.map((i) => i.toId) ?? [])
  return friends.value.filter(
    (f) => !memberIds.has(f.friend.id) && !invitedIds.has(f.friend.id),
  )
})

function showNotice(text: string): void {
  notice.value = text
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    notice.value = ''
  }, 4000)
}


/* =========================================================
   LOADING
   ========================================================= */

async function loadTrip(): Promise<void> {
  if (!tripId.value) return
  loading.value = true
  loadError.value = ''
  memberPoints.value = new Map()
  try {
    trip.value = await getTrip(tripId.value)
    meetingTimeInput.value = trip.value.meetingTime
      ? toLocalInputValue(trip.value.meetingTime)
      : ''
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : 'Could not load trip'
  } finally {
    loading.value = false
  }
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}

async function loadMessages(): Promise<void> {
  if (!tripId.value) return
  try {
    messages.value = await getTripMessages(tripId.value)
    scrollToBottom()
  } catch {
    // Chat still appears live once the socket is connected.
  }
}

async function loadFriends(): Promise<void> {
  try {
    friends.value = await apiRequest<Friendship[]>('/friendships')
  } catch {
    friends.value = []
  }
}

watch(tripId, (id) => {
  if (!id) return
  void loadTrip()
  void loadMessages()
  socket?.emit('trip:leave', { tripId: id })
  socket?.emit('trip:join', { tripId: id })
})

onMounted(() => {
  setupMap()
  connectSocket()
  void loadFriends()
  void loadTrip()
  void loadMessages()
})

onBeforeUnmount(() => {
  if (noticeTimer) clearTimeout(noticeTimer)
  if (typingEmitTimer) clearTimeout(typingEmitTimer)
  socket?.emit('trip:typing', { tripId: tripId.value, typing: false })
  socket?.emit('trip:leave', { tripId: tripId.value })
  socket?.disconnect()
  socket = undefined
map?.remove()
  map = undefined
  memberMarkerMap.clear()
  meetupMarker.value = null
  proposalMarker.value = null
})


/* =========================================================
   SOCKET
   ========================================================= */

function connectSocket(): void {
  socket = io(apiBaseUrl, {
    auth: (cb: (data: object) => void) => cb({ token: getAccessToken() }),
  })

  socket.on('connect', () => {
    socket?.emit('trip:join', { tripId: tripId.value })
  })

  socket.on('trip:joined', (data: { memberLocations: TripPoint[]; presence: { onlineUserIds: string[]; lastSeenByUserId?: Record<string, number> } }) => {
    const next = new Map(memberPoints.value)
    for (const point of data.memberLocations ?? []) {
      next.set(point.userId, point)
    }
    memberPoints.value = next
    presence.applySnapshot(
      data.presence.onlineUserIds ?? [],
      data.presence.lastSeenByUserId,
    )
    void loadTrip()
    void loadMessages()
  })

  socket.on('location:update', (point: TripPoint) => {
    if (!trip.value) return
    if (!trip.value.members.some((m) => m.userId === point.userId)) return
    const next = new Map(memberPoints.value)
    next.set(point.userId, point)
    memberPoints.value = next
  })

  socket.on('location:snapshot', (points: TripPoint[]) => {
    if (!trip.value) return
    const memberIds = new Set(trip.value.members.map((m) => m.userId))
    const next = new Map(memberPoints.value)
    for (const point of points ?? []) {
      if (memberIds.has(point.userId)) next.set(point.userId, point)
    }
    memberPoints.value = next
  })

  socket.on('location:hidden', ({ userId }: { userId: string }) => {
    if (!memberPoints.value.has(userId)) return
    const next = new Map(memberPoints.value)
    next.delete(userId)
    memberPoints.value = next
  })

  socket.on('trip:update', () => {
    void loadTrip()
  })

  socket.on(
    'trip:chat-new',
    (message: TripMessage) => {
      messages.value = [...messages.value, message]
      scrollToBottom()
    },
  )

  socket.on(
    'trip:typing',
    ({ userId, typing }: { userId: string; typing: boolean }) => {
      if (userId === auth.userId) return
      const next = new Set(typingMemberIds.value)
      if (typing) next.add(userId)
      else next.delete(userId)
      typingMemberIds.value = next
    },
  )

  socket.on(
    'trip:member-arrived',
    ({ userId, arrivedAt }: { userId: string; arrivedAt: string | null }) => {
      if (!trip.value) return
      trip.value.members = trip.value.members.map((m) =>
        m.userId === userId ? { ...m, arrivedAt } : m,
      )
    },
  )

  socket.on(
    'presence:update',
    (update: { userId: string; online: boolean; lastSeen: string }) => {
      if (update.online) presence.setOnline(update.userId)
      else {
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
      presence.applySnapshot(snapshot.onlineUserIds, snapshot.lastSeenByUserId)
    },
  )

  socket.on('trip:error', ({ message }: { message: string }) => {
    showNotice(message)
  })
}


/* =========================================================
   MAP
   ========================================================= */

function setupMap(): void {
  if (!mapElement.value || map) return
  map = L.map(mapElement.value, {
    zoomControl: true,
    attributionControl: false,
    zoomSnap: 0.5,
  }).setView([35.828, 10.64], 12)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
  }).addTo(map)

  map.on('click', (event: L.LeafletMouseEvent) => {
    if (!pickingSpot.value) return
    spotDraft.value = {
      lat: Math.round(event.latlng.lat * 1e6) / 1e6,
      lng: Math.round(event.latlng.lng * 1e6) / 1e6,
    }
    renderDraftMarker()
  })
}

function renderDraftMarker(): void {
  if (!map) return
  const existing = memberMarkerMap.get('__draft__')
  if (existing) {
    if (!spotDraft.value) {
      existing.remove()
      memberMarkerMap.delete('__draft__')
    }
    return
  }
  if (!spotDraft.value) return
  const icon = L.divIcon({
    className: 'trip-draft',
    html: '<div class="trip-draft-dot"></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  })
memberMarkerMap.set(
    '__draft__',
    L.marker([spotDraft.value.lat, spotDraft.value.lng], { icon }).addTo(
      map as L.Map,
    ),
  )
}

function meetupIcon(meetup: { lat: number; lng: number; name: string; setBy: string | null }, translucent = false): L.DivIcon {
  const bg = translucent ? '#b9833b' : '#e56b4f'
  return L.divIcon({
    className: 'trip-meetup',
    html: `<div class="trip-pin" style="background:${bg}">
      <div class="trip-pin-inner">M</div>
      <div class="trip-pin-tip"></div>
    </div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  })
}

function memberIcon(userId: string): L.DivIcon {
  const color = colorForUser(userId)
  return L.divIcon({
    className: 'trip-member-marker',
    html: `<div class="trip-member-dot" style="background:${color}">
      <span>${initialFor(userId)}</span>
    </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })
}

function clearMemberMarkers(): void {
  for (const [key, marker] of memberMarkerMap) {
    if (key === '__draft__') continue
    marker.remove()
    memberMarkerMap.delete(key)
  }
  meetupMarker.value?.remove()
  meetupMarker.value = null
  proposalMarker.value?.remove()
  proposalMarker.value = null
}

function redrawMap(): void {
  const currentMap = map
  if (!currentMap) return
  clearMemberMarkers()

  const meetup = meetupPoint.value
  if (meetup) {
    const icon = meetupIcon(meetup)
    meetupMarker.value = L.marker([meetup.lat, meetup.lng], { icon }).addTo(
      currentMap,
    )
    const label = meetup.setBy
      ? `${meetup.name} · set by ${meetup.setBy}`
      : `${meetup.name} · estimated from ${medianPoint.value?.count ?? 0} of ${participants.value.length}`
    meetupMarker.value.bindTooltip(label, { direction: 'top', offset: [0, -20] })
  }

  const proposal = proposalPoint.value
  if (proposal) {
    const icon = meetupIcon(
      { lat: proposal.lat, lng: proposal.lng, name: proposal.name, setBy: null },
      true,
    )
    proposalMarker.value = L.marker([proposal.lat, proposal.lng], { icon }).addTo(
      currentMap,
    )
    proposalMarker.value.bindTooltip(`${proposal.name} · proposed by ${proposal.by}`, {
      direction: 'top',
      offset: [0, -20],
    })
  }

  for (const point of memberPoints.value.values()) {
    const existing = memberMarkerMap.get(point.userId)
    if (existing) {
      existing.setLatLng([point.lat, point.lng])
      continue
    }
    const icon = memberIcon(point.userId)
    const marker = L.marker([point.lat, point.lng], { icon }).addTo(currentMap)
    marker.bindTooltip(usernameFor(point.userId), { direction: 'top', offset: [0, -16] })
    memberMarkerMap.set(point.userId, marker)
  }
}

watch([trip, memberPoints], () => {
  redrawMap()
})

watch(pickingSpot, (active) => {
  if (!active) {
    spotDraft.value = null
    const draft = memberMarkerMap.get('__draft__')
    if (draft) {
      draft.remove()
      memberMarkerMap.delete('__draft__')
    }
  }
})


/* =========================================================
   CHAT
   ========================================================= */

let scrollScheduled = false

function scrollToBottom(): void {
  if (scrollScheduled) return
  scrollScheduled = true
  void nextTick(() => {
    scrollScheduled = false
    if (threadEl.value) {
      threadEl.value.scrollTop = threadEl.value.scrollHeight
    }
  })
}

function emitTyping(typing: boolean): void {
  if (socket?.connected !== true) return
  socket.emit('trip:typing', { tripId: tripId.value, typing })
}

function handleDraftInput(): void {
  if (typingEmitTimer) {
    clearTimeout(typingEmitTimer)
    typingEmitTimer = undefined
  }
  if (draft.value.trim()) emitTyping(true)
  typingEmitTimer = setTimeout(() => emitTyping(false), 1200)
}

function send(): void {
  const body = draft.value.trim()
  if (!body || socket?.connected !== true || sending.value) return
  sending.value = true
  socket.emit('trip:chat', { tripId: tripId.value, body })
  draft.value = ''
  emitTyping(false)
  setTimeout(() => {
    sending.value = false
  }, 250)
}


/* =========================================================
   MEETUP ACTIONS
   ========================================================= */

function startPickingSpot(): void {
  pickingSpot.value = true
  spotDraft.value = null
  showNotice('Click the map to choose the new spot.')
}

function cancelPickingSpot(): void {
  pickingSpot.value = false
}

async function confirmSpotPicked(): Promise<void> {
  const spot = spotDraft.value
  if (!spot || !trip.value) return
  const name = window.prompt('Name for this spot?')?.trim() || undefined
  try {
    const result = await setTripMeetup(trip.value.id, { ...spot, name })
    trip.value = { ...trip.value, ...result.trip }
    showNotice(
      result.proposed
        ? 'Spot proposed — keep an eye out for confirmation.'
        : 'Meetup spot saved.',
    )
  } catch (err) {
    showNotice(err instanceof Error ? err.message : 'Could not save the spot')
} finally {
      pickingSpot.value = false
    }
  }

async function respondProposal(accept: boolean): Promise<void> {
  if (!trip.value) return
  try {
    const updated = await respondToMeetupProposal(trip.value.id, accept)
    trip.value = { ...trip.value, ...updated }
    showNotice(accept ? 'Proposal applied.' : 'Proposal declined.')
  } catch (err) {
    showNotice(err instanceof Error ? err.message : 'Could not respond to proposal')
  }
}


/* =========================================================
   ALTERNATE MEETUP (AUTO MODE FIX)
   ========================================================= */

async function fixAutoMeetup(): Promise<void> {
  const median = medianPoint.value
  if (!median) {
    showNotice('No live member locations yet to pin down.')
    return
  }
  try {
    const result = await setTripMeetup(trip.value!.id, {
      lat: median.lat,
      lng: median.lng,
      name: 'Meet in the middle',
    })
    trip.value = { ...trip.value!, ...result.trip }
    showNotice('Meetup pinned to the middle point.')
  } catch (err) {
    showNotice(err instanceof Error ? err.message : 'Could not pin the meetup')
  }
}


/* =========================================================
   ARRIVAL & SCHEDULE
   ========================================================= */

async function markArrived(): Promise<void> {
  if (!trip.value || meArrived.value) return
  try {
    const updated = await arriveAtTrip(trip.value.id)
    trip.value.members = trip.value.members.map((m) =>
      m.userId === updated.userId ? { ...m, arrivedAt: updated.arrivedAt } : m,
    )
    showNotice('Everyone knows you made it. Nice.')
  } catch (err) {
    showNotice(err instanceof Error ? err.message : 'Could not check you in')
  }
}

async function saveMeetingTime(): Promise<void> {
  if (!trip.value) return
  try {
    const value = meetingTimeInput.value
    const updated = await updateTrip(trip.value.id, {
      meetingTime: value ? new Date(value).toISOString() : null,
    })
    trip.value = { ...trip.value, ...updated }
    showNotice(value ? 'Meeting time saved.' : 'Meeting time cleared.')
  } catch (err) {
    showNotice(err instanceof Error ? err.message : 'Could not save the time')
  }
}


/* =========================================================
   INVITES
   ========================================================= */

function openInviteModal(): void {
  selectedInviteIds.value = []
  inviteModalOpen.value = true
}

function toggleInvite(friendId: string): void {
  const set = new Set(selectedInviteIds.value)
  if (set.has(friendId)) set.delete(friendId)
  else set.add(friendId)
  selectedInviteIds.value = [...set]
}

async function sendInvites(): Promise<void> {
  if (!trip.value) return
  try {
    for (const friendId of selectedInviteIds.value) {
      await inviteToTrip(trip.value.id, friendId)
    }
    showNotice('Invites sent.')
    inviteModalOpen.value = false
    await loadTrip()
  } catch (err) {
    showNotice(err instanceof Error ? err.message : 'Could not send invites')
  }
}


/* =========================================================
   TRIP MANAGEMENT
   ========================================================= */

async function archiveTripAction(): Promise<void> {
  if (!trip.value) return
  if (!window.confirm('Archive this trip?')) return
  try {
    const updated = await archiveTrip(trip.value.id)
    trip.value = { ...trip.value, ...updated }
    showNotice('Trip archived.')
  } catch (err) {
    showNotice(err instanceof Error ? err.message : 'Could not archive the trip')
  }
}

async function removeTripAction(): Promise<void> {
  if (!trip.value) return
  if (!window.confirm('Permanently delete this trip for everyone?')) return
  try {
    await deleteTrip(trip.value.id)
    await router.push('/trips')
  } catch (err) {
    showNotice(err instanceof Error ? err.message : 'Could not delete the trip')
  }
}

async function leaveTripAction(): Promise<void> {
  if (!trip.value) return
  if (!window.confirm('Leave this trip?')) return
  try {
    await leaveTrip(trip.value.id)
    await router.push('/trips')
  } catch (err) {
    showNotice(err instanceof Error ? err.message : 'Could not leave the trip')
  }
}

function backToTrips(): void {
  void router.push('/trips')
}</script>
<template>
  <div class="trip-shell">
    <div class="trip-topbar">
      <button
        class="icon-button trip-back"
        type="button"
        aria-label="Back to trips"
        @click="backToTrips"
      >
        &lsaquo;
      </button>
      <div class="trip-title">
        <h1>{{ trip?.name ?? "Trip" }}</h1>
        <span
          class="trip-status-chip"
          :class="trip ? trip.status.toLowerCase() : ''"
        >
          {{ trip?.status ?? "loading" }}
        </span>
      </div>
      <div class="trip-top-actions">
        <button
          v-if="isAdmin"
          class="button button-outline"
          type="button"
          @click="archiveTripAction"
        >
          Archive
        </button>
        <button
          v-if="isAdmin"
          class="button button-outline trip-danger"
          type="button"
          @click="removeTripAction"
        >
          Delete
        </button>
        <button
          v-else
          class="button button-outline"
          type="button"
          @click="leaveTripAction"
        >
          Leave
        </button>
      </div>
    </div>

    <div v-if="notice" class="trip-notice">{{ notice }}</div>

    <div v-if="loading" class="trip-empty">
      <p class="hint">Loading trip�</p>
    </div>

    <div v-else-if="loadError" class="trip-empty">
      <p class="hint">{{ loadError }}</p>
      <button class="button" type="button" @click="backToTrips">
        Back to trips
      </button>
    </div>

    <template v-else-if="trip">
      <div class="trip-layout">
        <section class="trip-left">
          <div class="trip-map-wrap">
            <div ref="mapElement" class="trip-map"></div>

            <div v-if="pickingSpot" class="trip-pick-bar">
              <span>Click the map to place the spot.</span>
              <button
                class="button"
                type="button"
                :disabled="!spotDraft"
                @click="confirmSpotPicked"
              >
                Use this spot
              </button>
              <button
                class="button button-outline"
                type="button"
                @click="cancelPickingSpot"
              >
                Cancel
              </button>
            </div>
          </div>

          <div class="trip-card">
            <div class="trip-card-head">
              <span class="trip-card-label">Meetup</span>
              <span
                class="trip-mode-chip"
                :class="trip.meetupMode.toLowerCase()"
              >
                {{
                  trip.meetupMode === "AUTO"
                    ? "Meet in the middle"
                    : "Fixed spot"
                }}
              </span>
            </div>

            <template v-if="meetupPoint">
              <p class="trip-card-title">{{ meetupPoint.name }}</p>
              <p v-if="meetupPoint.setBy" class="trip-card-sub">
                set by {{ meetupPoint.setBy }}
              </p>
              <p
                v-else-if="trip.meetupMode === 'AUTO'"
                class="trip-card-sub"
              >
                moves with everyone &middot;
                {{ medianPoint?.count ?? 0 }} of
                {{ participants.length }} members sharing
              </p>
              <div
                v-if="trip.meetupMode === 'AUTO'"
                class="trip-card-actions"
              >
                <button
                  class="button button-outline"
                  type="button"
                  :disabled="!hasLiveMemberLocations"
                  @click="fixAutoMeetup"
                >
                  Pin this spot
                </button>
              </div>
            </template>
            <p v-else class="trip-card-sub">
              Share your location so we can estimate a middle point.
            </p>

            <div v-if="proposalPoint" class="trip-proposal">
              <p class="trip-card-title">
                {{ proposalPoint.name }} &middot; proposed by
                {{ proposalPoint.by }}
              </p>
              <div
                v-if="proposalPoint.by !== 'You'"
                class="trip-card-actions"
              >
                <button
                  class="button button-success"
                  type="button"
                  @click="respondProposal(true)"
                >
                  Accept
                </button>
                <button
                  class="button button-outline"
                  type="button"
                  @click="respondProposal(false)"
                >
                  Nope
                </button>
              </div>
              <p v-else class="trip-card-sub">
                Waiting for someone else to confirm.
              </p>
            </div>
            <div v-else-if="canProposeSpot" class="trip-card-actions">
              <button
                class="button button-outline"
                type="button"
                @click="startPickingSpot"
              >
                Propose a new spot
              </button>
            </div>
          </div>

          <div class="trip-card">
            <div class="trip-card-head">
              <span class="trip-card-label">Meeting time</span>
            </div>
            <div class="trip-time-row">
              <input
                v-if="isAdmin"
                v-model="meetingTimeInput"
                class="trip-time-input"
                type="datetime-local"
                @change="saveMeetingTime"
              />
              <p
                v-else
                class="trip-card-title"
              >
                {{ formatMeetingTime(trip.meetingTime) || "Not set yet" }}
              </p>
            </div>
            <p v-if="isAdmin" class="trip-card-sub">
              {{
                trip.meetingTime
                  ? formatMeetingTime(trip.meetingTime)
                  : "Pick a time and everyone sees it."
              }}
            </p>
          </div>

          <div
            v-if="trip.status === 'DECIDED'"
            class="trip-card trip-arrive"
          >
            <div v-if="meArrived" class="trip-check">
              You&rsquo;re here � let them know. ?
            </div>
            <template v-else>
              <button
                class="button button-success"
                type="button"
                @click="markArrived"
              >
                I&rsquo;m here
              </button>
              <p class="trip-card-sub">
                Everyone in the trip gets a &ldquo;arrived&rdquo; tag.
              </p>
            </template>
          </div>

          <div class="trip-card">
            <div class="trip-card-head">
              <span class="trip-card-label">Participants</span>
              <button
                class="button button-outline small-button"
                type="button"
                @click="openInviteModal"
              >
                Invite friends
              </button>
            </div>
            <ul class="trip-members">
              <li
                v-for="member in participants"
                :key="member.userId"
                class="trip-member-row"
              >
                <span
                  class="conversation-avatar trip-member-avatar"
                  :style="{ background: colorForUser(member.userId) }"
                >
                  {{ initialFor(member.userId) }}
                </span>
                <div class="trip-member-info">
                  <div class="trip-member-line">
                    <span class="trip-member-name">{{ member.username }}</span>
                    <span
                      v-if="member.role === 'ADMIN'"
                      class="trip-role-chip"
                    >
                      organizer
                    </span>
                    <span v-if="member.arrived" class="trip-role-chip arrived">
                      arrived ?
                    </span>
                  </div>
                  <div class="trip-member-sub">
                    <i
                      class="presence-dot"
                      :class="member.online ? 'online' : 'offline'"
                    ></i>
                    <span v-if="member.online">Online</span>
                    <span
                      v-else-if="presence.lastSeen(member.userId)"
                    >
                      Last seen
                      {{ lastSeenText(presence.lastSeen(member.userId)) }}
                    </span>
                    <span v-else>Offline</span>
                    <span v-if="member.distance != null">
                      &middot; {{ formatDistanceKm(member.distance) }} to spot
                    </span>
                    <span v-else-if="!member.sharing">
                      &middot; not sharing
                    </span>
                  </div>
                </div>
              </li>
            </ul>
          </div>
        </section>

        <section class="trip-right">
          <div class="trip-chat">
            <div class="trip-chat-head">
              <span>Trip chat</span>
              <span v-if="typingNames" class="typing-hint">
                {{ typingNames }}
              </span>
            </div>

            <div ref="threadEl" class="trip-thread">
              <p v-if="messages.length === 0" class="hint trip-chat-empty">
                No messages yet. Say hi!
              </p>
              <div
                v-for="message in messages"
                :key="message.id"
                class="message-row trip-msg-row"
                :class="{ own: message.senderId === auth.userId }"
              >
                <div class="message-bubble trip-msg-bubble">
                  <span
                    v-if="message.senderId !== auth.userId"
                    class="trip-msg-author"
                  >
                    {{ usernameFor(message.senderId) }}
                  </span>
                  <p>{{ message.body }}</p>
                  <span class="message-meta">
                    {{ formatChatTime(message.createdAt) }}
                  </span>
                </div>
              </div>
            </div>

            <div class="message-composer trip-composer">
              <input
                v-model="draft"
                type="text"
                placeholder="Message the group�"
                autocomplete="off"
                :disabled="!socket?.connected"
                @input="handleDraftInput"
                @keydown.enter.prevent="send"
              />
              <button
                class="button button-primary"
                type="button"
                :disabled="!draft.trim() || !socket?.connected"
                @click="send"
              >
                Send
              </button>
            </div>
          </div>
        </section>
      </div>

      <div
        v-if="inviteModalOpen"
        class="modal-backdrop"
        @click.self="inviteModalOpen = false"
      >
        <div class="modal">
          <div class="modal-head">
            <h2>Invite friends</h2>
            <button
              class="friend-card-close"
              type="button"
              aria-label="Close invite list"
              @click="inviteModalOpen = false"
            >
              �
            </button>
          </div>

          <div v-if="invitableFriends.length" class="picker-list">
            <div
              v-for="friend in invitableFriends"
              :key="friend.friend.id"
              class="list-row picker-row trip-invite-row"
              role="button"
              tabindex="0"
              @click="toggleInvite(friend.friend.id)"
              @keydown.enter="toggleInvite(friend.friend.id)"
            >
              <span class="conversation-avatar">
                {{ friend.friend.username.charAt(0).toUpperCase() }}
              </span>
              <div class="trip-invite-info">
                <strong>{{ friend.friend.username }}</strong>
              </div>
              <span
                class="trip-invite-check"
                :class="{
                  checked: selectedInviteIds.includes(friend.friend.id),
                }"
              >
                {{ selectedInviteIds.includes(friend.friend.id) ? "?" : "" }}
              </span>
            </div>
          </div>
          <p v-else class="hint trip-invite-empty">
            Everyone you know is already in this trip.
          </p>

          <div class="trip-modal-actions">
            <button
              class="button"
              type="button"
              :disabled="selectedInviteIds.length === 0"
              @click="sendInvites"
            >
              Invite {{ selectedInviteIds.length || "" }}
              friend{{ selectedInviteIds.length === 1 ? "" : "s" }}
            </button>
            <button
              class="button button-outline"
              type="button"
              @click="inviteModalOpen = false"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
