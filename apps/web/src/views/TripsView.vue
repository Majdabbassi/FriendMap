<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  apiRequest,
  createTrip,
  listTripInvites,
  listTrips,
  respondToInvite,
  type Friendship,
  type TripInvite,
  type TripListItem,
} from '../api'
import { useAuthStore } from '../stores/auth'
import { usePresenceStore } from '../stores/presence'
import SpotMap from '../components/SpotMap.vue'

type MemberRow = {
  userId: string
  username: string
  initial: string
  color: string
  online: boolean
  arrived: boolean
}

const router = useRouter()
const auth = useAuthStore()
const presence = usePresenceStore()

const loading = ref(true)
const loadError = ref('')
const trips = ref<TripListItem[]>([])
const invites = ref<TripInvite[]>([])
const friends = ref<Friendship[]>([])
const notice = ref('')

const createOpen = ref(false)
const creating = ref(false)
const newName = ref('')
const newMode = ref<'AUTO' | 'FIXED'>('AUTO')
const newMemberIds = ref<string[]>([])
const newSpot = ref<{ lat: number; lng: number; name?: string } | null>(null)
const newMeetingTime = ref('')

const archivedOpen = ref(false)

let noticeTimer: ReturnType<typeof setTimeout> | undefined

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

const pendingInvites = computed(() =>
  invites.value.filter((invite) => invite.status === 'PENDING'),
)

const upcomingTrips = computed(() =>
  trips.value.filter((trip) => trip.status !== 'ARCHIVED').sort(sortUpcoming),
)

const archivedTrips = computed(() =>
  trips.value
    .filter((trip) => trip.status === 'ARCHIVED')
    .sort(
      (a, b) =>
        timeOf(b.archivedAt ?? b.createdAt) - timeOf(a.archivedAt ?? a.createdAt),
    ),
)

const selectedMembers = computed(() =>
  friends.value.filter((f) => newMemberIds.value.includes(f.friend.id)),
)

const createSummary = computed(() => {
  const people = newMemberIds.value.length
  const who = people
    ? `You + ${people} friend${people === 1 ? '' : 's'}`
    : 'Just you'
  const where =
    newMode.value === 'AUTO'
      ? 'Meet in the middle'
      : newSpot.value?.name ??
        (newSpot.value ? 'Pinned spot' : 'Pick a place')
  const when = newMeetingTime.value
    ? ' · ' +
      new Date(newMeetingTime.value).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''
  return `${who} · ${where}${when}`
})

function timeOf(value: string): number {
  return new Date(value).getTime()
}

function sortUpcoming(a: TripListItem, b: TripListItem): number {
  const rank = (t: TripListItem) => (t.status === 'DECIDED' ? 0 : 1)
  if (rank(a) !== rank(b)) return rank(a) - rank(b)
  const ra = a.meetingTime ? timeOf(a.meetingTime) : Number.POSITIVE_INFINITY
  const rb = b.meetingTime ? timeOf(b.meetingTime) : Number.POSITIVE_INFINITY
  if (ra !== rb) return ra - rb
  return timeOf(b.createdAt) - timeOf(a.createdAt)
}

function usernameFor(userId: string): string {
  if (userId === auth.userId) return 'You'
  return (
    friends.value.find((f) => f.friend.id === userId)?.friend.username ?? 'Friend'
  )
}

function colorForUser(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0
  }
  return FRIEND_COLORS[hash % FRIEND_COLORS.length]!
}

function memberRows(trip: TripListItem): MemberRow[] {
  return trip.members.map((member) => ({
    userId: member.userId,
    username: usernameFor(member.userId),
    initial: usernameFor(member.userId).charAt(0).toUpperCase(),
    color: colorForUser(member.userId),
    online: presence.isOnline(member.userId),
    arrived: member.arrivedAt != null,
  }))
}

function showNotice(text: string): void {
  notice.value = text
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    notice.value = ''
  }, 4000)
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

function statusLabel(status: TripListItem['status']): string {
  return status === 'DRAFT' ? 'Organizing' : status === 'DECIDED' ? 'Go time' : 'Archived'
}

function meetingLabel(trip: TripListItem): string {
  if (!trip.meetingTime) return 'No time yet'
  const diff = timeOf(trip.meetingTime) - Date.now()
  const minutes = Math.round(diff / 60_000)
  const label = Math.abs(minutes) < 1 ? 'now' : prettyDelta(minutes)
  return `${formatMeetingTime(trip.meetingTime)} · ${label}`
}

function prettyDelta(minutes: number): string {
  if (minutes >= 0) {
    if (minutes < 60) return `in ${minutes}m`
    const hours = Math.floor(minutes / 60)
    return hours < 24 ? `in ${hours}h` : `in ${Math.floor(hours / 24)}d`
  }
  const abs = Math.abs(minutes)
  if (abs < 60) return `${abs}m ago`
  const hours = Math.floor(abs / 60)
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}

async function loadAll(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    const [tripList, inviteList] = await Promise.all([
      listTrips(),
      listTripInvites(),
    ])
    trips.value = tripList
    invites.value = inviteList
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : 'Could not load trips'
  } finally {
    loading.value = false
  }
}

async function loadFriends(): Promise<void> {
  try {
    friends.value = await apiRequest<Friendship[]>('/friendships')
  } catch {
    friends.value = []
  }
}

async function respondToInviteAction(invite: TripInvite, accept: boolean): Promise<void> {
  try {
    const updated = await respondToInvite(invite.id, accept)
    invites.value = invites.value.map((i) => (i.id === invite.id ? updated : i))
    showNotice(accept ? 'You are in!' : 'Invite declined.')
    await loadAll()
  } catch (err) {
    showNotice(err instanceof Error ? err.message : 'Could not respond to invite')
  }
}

function openCreate(): void {
  newName.value = ''
  newMode.value = 'AUTO'
  newMemberIds.value = []
  newSpot.value = null
  newMeetingTime.value = ''
  createOpen.value = true
}

function toggleCreateMember(friendId: string): void {
  const set = new Set(newMemberIds.value)
  if (set.has(friendId)) set.delete(friendId)
  else set.add(friendId)
  newMemberIds.value = [...set]
}

function onSpotPicked(spot: { lat: number; lng: number }): void {
  newSpot.value = { ...spot }
  window.setTimeout(() => {
    const name = window.prompt('Name for this spot?')?.trim()
    if (name && newSpot.value) {
      const current = newSpot.value
      newSpot.value = { lat: current.lat, lng: current.lng, name }
    }
  }, 0)
}

function showOnMap(trip: TripListItem): void {
  void router.push({ path: '/map', query: { trip: trip.id } })
}

async function submitCreate(): Promise<void> {
  const name = newName.value.trim()
  if (!name || creating.value) return
  creating.value = true
  notice.value = ''
  try {
    const payload: {
      name: string
      memberIds: string[]
      meetupLat?: number
      meetupLng?: number
      meetupName?: string
      meetingTime?: string
    } = {
      name,
      memberIds: newMemberIds.value,
    }
    if (newMode.value === 'FIXED') {
      if (!newSpot.value) {
        showNotice('Pick a spot on the map first.')
        creating.value = false
        return
      }
      Object.assign(payload, {
        meetupLat: newSpot.value.lat,
        meetupLng: newSpot.value.lng,
        meetupName: newSpot.value.name ?? 'Meetup spot',
      })
    }
    const meetingTime = newMeetingTime.value
    if (meetingTime) {
      Object.assign(payload, { meetingTime: new Date(meetingTime).toISOString() })
    }
    const { trip } = await createTrip(payload)
    createOpen.value = false
    await router.push(`/trips/${trip.id}`)
  } catch (err) {
    showNotice(err instanceof Error ? err.message : 'Could not create trip')
  } finally {
    creating.value = false
  }
}

onMounted(() => {
  void loadAll()
  void loadFriends()
})
</script>

<template>
  <section class="trip-shell trips-shell">
    <div class="trip-topbar trips-topbar">
      <div class="trip-title trips-title-block">
        <p class="eyebrow">PLANS</p>
        <h1>Trips</h1>
        <p class="trips-headline">
          Invite friends, pick a spot, and get to the meet-up.
        </p>
      </div>
      <div class="trip-top-actions">
        <button class="button button-primary" type="button" @click="openCreate">
          + Plan a meetup
        </button>
      </div>
    </div>

    <div v-if="notice" class="trip-notice">{{ notice }}</div>

    <div v-if="loading" class="trip-empty">
      <p class="hint">Loading trips…</p>
    </div>

    <div v-else-if="loadError" class="trip-empty">
      <p class="hint">{{ loadError }}</p>
      <button class="button" type="button" @click="loadAll">Try again</button>
    </div>

    <template v-else>
      <section v-if="pendingInvites.length" class="trips-section">
        <div class="trips-section-head">
          <h2 class="trips-section-title">You&rsquo;ve been invited</h2>
          <span class="trips-count">{{ pendingInvites.length }}</span>
        </div>
        <div class="trips-invites">
          <div
            v-for="invite in pendingInvites"
            :key="invite.id"
            class="trip-invite-card"
          >
            <span class="map-find-avatar trip-invite-avatar">
              {{ (invite.from?.username ?? '?').charAt(0).toUpperCase() }}
            </span>
            <div class="trip-invite-body">
              <p class="trip-invite-name">{{ invite.trip?.name ?? 'Trip' }}</p>
              <p class="trip-card-sub">
                {{ invite.from?.username ?? 'A friend' }} invited you
                <span v-if="invite.trip?.meetingTime">
                  &middot; {{ formatMeetingTime(invite.trip.meetingTime) }}
                </span>
              </p>
            </div>
            <div class="trip-card-actions trip-invite-actions">
              <button
                class="button button-success"
                type="button"
                @click="respondToInviteAction(invite, true)"
              >
                Join
              </button>
              <button
                class="button button-outline"
                type="button"
                @click="respondToInviteAction(invite, false)"
              >
                Decline
              </button>
            </div>
          </div>
        </div>
      </section>

<section class="trips-section">
        <div class="trips-section-head">
          <h2 class="trips-section-title">Upcoming</h2>
          <span v-if="upcomingTrips.length" class="trips-count">
            {{ upcomingTrips.length }}
          </span>
        </div>

        <div v-if="!upcomingTrips.length && !archivedTrips.length" class="trip-empty">
          <p class="trip-empty-title">No trips yet</p>
          <p class="hint">
            Create a meet-up with a friend or two and the plan shows up here.
          </p>
          <button class="button button-primary" type="button" @click="openCreate">
            Plan your first meetup
          </button>
        </div>

        <div v-else-if="!upcomingTrips.length" class="trip-empty">
          <p class="hint">Nothing on the calendar — plan something fun.</p>
        </div>

        <div v-else class="trips-grid">
          <div
            v-for="trip in upcomingTrips"
            :key="trip.id"
            class="trip-card trips-card"
            :class="`trip-list-${trip.status.toLowerCase()}`"
            role="button"
            tabindex="0"
            @click="router.push(`/trips/${trip.id}`)"
            @keydown.enter="router.push(`/trips/${trip.id}`)"
          >
            <span class="trip-list-rail"></span>
            <div class="trip-list-body">
              <div class="trip-card-head">
                <span class="trip-card-label" :title="trip.name">
                  {{ trip.status === 'DECIDED' ? 'Happening' : 'Setting it up' }}
                </span>
                <span class="trip-badge-row">
                  <span class="trip-mode-chip" :class="trip.meetupMode.toLowerCase()">
                    {{
                      trip.meetupMode === 'AUTO'
                        ? 'middle'
                        : trip.meetupName ?? 'fixed spot'
                    }}
                  </span>
                  <span class="trip-status-chip" :class="trip.status.toLowerCase()">
                    {{ statusLabel(trip.status) }}
                  </span>
                </span>
              </div>

              <h3 class="trip-list-name">{{ trip.name }}</h3>
              <p class="trip-list-sub">{{ meetingLabel(trip) }}</p>

              <div class="trip-list-members">
                <span
                  v-for="member in memberRows(trip).slice(0, 4)"
                  :key="member.userId"
                  class="trip-stack-avatar"
                  :class="{ arrived: member.arrived }"
                  :style="{ background: member.color }"
                  :title="member.username + (member.arrived ? ' · arrived' : '')"
                >
                  <span>{{ member.initial }}</span>
                  <i class="trip-stack-online" :class="member.online ? 'on' : 'off'"></i>
                </span>
                <span v-if="memberRows(trip).length > 4" class="trip-stack-more">
                  +{{ memberRows(trip).length - 4 }}
                </span>
                <span class="trip-list-count">
                  {{ trip.memberCount }}
                  {{ trip.memberCount === 1 ? 'person' : 'people' }}
                </span>
              </div>

              <div class="trip-list-foot">
                <button
                  class="button button-primary trip-open-btn"
                  type="button"
                  @click.stop="router.push(`/trips/${trip.id}`)"
                >
                  Open trip
                </button>
                <button
                  class="button subtle"
                  type="button"
                  @click.stop="showOnMap(trip)"
                >
                  Show on map
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="trips-section">
        <button
          class="trips-archive-toggle"
          type="button"
          :class="{ open: archivedOpen }"
          @click="archivedOpen = !archivedOpen"
        >
          <span class="trips-section-title" style="margin: 0">Archived</span>
          <span class="trips-count">{{ archivedTrips.length }}</span>
          <span class="trips-caret">{{ archivedOpen ? '▾' : '▸' }}</span>
        </button>

        <div v-if="archivedOpen" class="trips-archived">
          <div
            v-for="trip in archivedTrips"
            :key="trip.id"
            class="trip-card trips-card trips-archived-card"
            role="button"
            tabindex="0"
            @click="router.push(`/trips/${trip.id}`)"
            @keydown.enter="router.push(`/trips/${trip.id}`)"
          >
            <div class="trip-list-body">
              <div class="trip-card-head">
                <span class="trip-card-label" :title="trip.name">{{ trip.name }}</span>
                <span class="trip-badge-row">
                  <span class="trip-mode-chip" :class="trip.meetupMode.toLowerCase()">
                    {{
                      trip.meetupMode === 'AUTO'
                        ? 'middle'
                        : trip.meetupName ?? 'fixed spot'
                    }}
                  </span>
                </span>
              </div>
              <p class="trip-list-sub">
                {{ formatMeetingTime(trip.meetingTime) || 'No meeting time' }}
                &middot; {{ trip.memberCount }}
                {{ trip.memberCount === 1 ? 'person' : 'people' }}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div
        v-if="createOpen"
        class="modal-backdrop"
        @click.self="createOpen = false"
      >
        <div class="modal trips-create-modal">
          <div class="modal-head">
            <h2>New trip</h2>
            <button
              class="friend-card-close"
              type="button"
              aria-label="Close create trip"
              @click="createOpen = false"
            >
              ×
            </button>
          </div>

          <label class="trip-field">
            <span>What are we planning?</span>
            <input
              v-model="newName"
              class="friend-search"
              type="text"
              placeholder="Picnic at the lake"
              autocomplete="off"
              @keydown.enter="submitCreate"
            />
          </label>

          <div class="trip-field">
            <span>Who is coming?</span>
            <div v-if="friends.length" class="picker-list trip-picker">
              <div
                v-for="friend in friends"
                :key="friend.friend.id"
                class="list-row picker-row"
                :class="{ picked: newMemberIds.includes(friend.friend.id) }"
                role="button"
                tabindex="0"
                @click="toggleCreateMember(friend.friend.id)"
                @keydown.enter="toggleCreateMember(friend.friend.id)"
              >
                <span class="conversation-avatar">
                  {{ friend.friend.username.charAt(0).toUpperCase() }}
                </span>
                <div>
                  <strong>{{ friend.friend.username }}</strong>
                  <small v-if="presence.isOnline(friend.friend.id)" class="picker-online">
                    online
                  </small>
                </div>
                <span
                  class="trip-invite-check"
                  :class="{ checked: newMemberIds.includes(friend.friend.id) }"
                >
                  {{ newMemberIds.includes(friend.friend.id) ? '✓' : '' }}
                </span>
              </div>
            </div>
            <p v-if="!friends.length" class="hint">No friends yet to invite.</p>
          </div>

          <div v-if="selectedMembers.length" class="trip-member-chips">
            <span
              v-for="friend in selectedMembers"
              :key="friend.friend.id"
              class="trip-member-chip"
            >
              {{ friend.friend.username }}
              <button
                type="button"
                aria-label="Remove friend"
                @click="toggleCreateMember(friend.friend.id)"
              >
                ×
              </button>
            </span>
          </div>

          <div class="trip-field">
            <span>Where do we meet?</span>
            <div class="trip-mode-picker">
              <button
                class="button trip-mode-option"
                :class="{ active: newMode === 'AUTO' }"
                type="button"
                @click="newMode = 'AUTO'"
              >
                <strong>Meet in the middle</strong>
                <small>Picks a fair spot from everyone&rsquo;s live location.</small>
              </button>
              <button
                class="button trip-mode-option"
                :class="{ active: newMode === 'FIXED' }"
                type="button"
                @click="newMode = 'FIXED'"
              >
                <strong>Pick a place</strong>
                <small>You choose the exact spot — friends join it.</small>
              </button>
            </div>
          </div>

          <div v-if="newMode === 'FIXED'" class="trip-field">
            <SpotMap
              :center="{ lat: 35.828, lng: 10.64 }"
              :zoom="11"
              :value="newSpot"
              @pick="onSpotPicked"
            />
            <p class="hint trip-map-hint">
              Click the map to drop the pin
              {{ newSpot?.name ? ` · "${newSpot.name}"` : '' }}.
            </p>
          </div>

          <div class="trip-field">
            <span>Meeting time (optional)</span>
            <input
              v-model="newMeetingTime"
              class="trip-time-input"
              type="datetime-local"
            />
          </div>

          <p class="trip-create-summary">{{ createSummary }}</p>

          <div class="trip-modal-actions">
            <button
              class="button button-primary"
              type="button"
              :disabled="!newName.trim() || creating"
              @click="submitCreate"
            >
              {{ newMode === 'FIXED' && !newSpot ? 'Pick a spot first' : 'Start the trip' }}
            </button>
            <button
              class="button button-outline"
              type="button"
              @click="createOpen = false"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>