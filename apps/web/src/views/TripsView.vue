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
import { usePresenceStore } from '../stores/presence'
import SpotMap from '../components/SpotMap.vue'

const router = useRouter()
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

let noticeTimer: ReturnType<typeof setTimeout> | undefined

const pendingInvites = computed(() =>
  invites.value.filter((invite) => invite.status === 'PENDING'),
)

const newMemberOptions = computed(() =>
  friends.value.filter((f) => !newMemberIds.value.includes(f.friend.id)),
)

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
    invites.value = invites.value.map((i) =>
      i.id === invite.id ? updated : i,
    )
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
    <div class="trip-topbar">
      <div class="trip-title">
        <h1>Trips</h1>
        <span class="trip-status-chip decided">plans</span>
      </div>
      <div class="trip-top-actions">
        <button class="button button-primary" type="button" @click="openCreate">
          + New trip
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
        <h2 class="trips-section-title">Invites</h2>
        <div class="trips-invites">
          <div
            v-for="invite in pendingInvites"
            :key="invite.id"
            class="trip-invite-card"
          >
            <p class="trip-invite-name">{{ invite.trip?.name ?? "Trip" }}</p>
            <p class="trip-card-sub">
              invited you by {{ invite.from?.username ?? "friend" }}
              &middot; {{ formatMeetingTime(invite.trip?.meetingTime ?? null) }}
            </p>
            <div class="trip-card-actions">
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
        <h2 class="trips-section-title">
          Your trips
          <span v-if="trips.length">({{ trips.length }})</span>
        </h2>
        <p v-if="!trips.length" class="hint trips-empty">
          No trips yet — start a meet-up with a friend or two.
        </p>
        <div class="trips-grid">
          <div
            v-for="trip in trips"
            :key="trip.id"
            class="trip-card trips-card"
            role="button"
            tabindex="0"
            @click="router.push(`/trips/${trip.id}`)"
            @keydown.enter="router.push(`/trips/${trip.id}`)"
          >
            <div class="trip-card-head">
              <span class="trip-card-label">{{ trip.name }}</span>
              <span
                class="trip-mode-chip"
                :class="trip.meetupMode.toLowerCase()"
              >
                {{
                  trip.meetupMode === "AUTO"
                    ? "middle"
                    : trip.meetupName ?? "fixed spot"
                }}
              </span>
            </div>
            <p class="trip-card-sub">
              {{ statusLabel(trip.status) }}
              &middot; {{ trip.memberCount }}
              {{ trip.memberCount === 1 ? "person" : "people" }}
              <span v-if="trip.meetingTime">
                &middot; {{ formatMeetingTime(trip.meetingTime) }}
              </span>
            </p>
            <div class="trip-card-foot">
              <span
                v-for="member in trip.members"
                :key="member.userId"
                class="trip-avatar-chip"
                :title="
                  member.arrivedAt ? 'arrived at the spot' : 'in the trip'
                "
              >
                {{ presence.isOnline(member.userId) ? "●" : "○" }}
              </span>
            </div>
            <span
              class="trip-status-chip"
              :class="trip.status.toLowerCase()"
            >
              {{ trip.status }}
            </span>
          </div>
        </div>
      </section>
    </template>

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
          />
        </label>

        <div class="trip-field">
          <span>Who is coming?</span>
          <div v-if="newMemberOptions.length" class="picker-list trip-picker">
            <div
              v-for="friend in newMemberOptions"
              :key="friend.friend.id"
              class="list-row picker-row"
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
              </div>
              <span
                class="trip-invite-check"
                :class="{
                  checked: newMemberIds.includes(friend.friend.id),
                }"
              >
                {{ newMemberIds.includes(friend.friend.id) ? "✓" : "" }}
              </span>
            </div>
          </div>
          <p v-else class="hint">Just you for now — you can invite later.</p>
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
            Click the map to drop the pin{{ newSpot?.name ? ` · "${newSpot.name}"` : "" }}.
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

        <div class="trip-modal-actions">
          <button
            class="button button-primary"
            type="button"
            :disabled="!newName.trim() || creating"
            @click="submitCreate"
          >
            {{ newMode === "FIXED" && !newSpot ? "Pick a spot first" : "Start the trip" }}
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
  </section>
</template>