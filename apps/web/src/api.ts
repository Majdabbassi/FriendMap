type AuthTokens = { access_token: string; refresh_token: string }

declare global {
  interface Window {
    __FRIENDMAP_API_URL__?: string
  }
}

const ACCESS_TOKEN_KEY = 'friendmap_token'
const REFRESH_TOKEN_KEY = 'friendmap_refresh_token'

function resolveApiBaseUrl(): string {
  if (typeof window !== 'undefined' && window.__FRIENDMAP_API_URL__) {
    return window.__FRIENDMAP_API_URL__.replace(/\/$/, '')
  }
  const baked = (import.meta.env.VITE_API_URL as string | undefined ?? '').trim()
  if (baked) return baked.replace(/\/$/, '')
  if (typeof window !== 'undefined') return window.location.origin.replace(/\/$/, '')
  return 'http://localhost:3000'
}

export const apiBaseUrl = resolveApiBaseUrl()

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function setTokens(tokens: AuthTokens): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.access_token)
  localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token)
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

let refreshPromise: Promise<boolean> | null = null
let authFailureHandler: (() => void) | null = null

export function setAuthFailureHandler(handler: (() => void) | null): void {
  authFailureHandler = handler
}

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (!response.ok) return false
      const data = (await response.json()) as AuthTokens
      setTokens(data)
      return true
    } catch {
      return false
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}

function invalidateSession(): void {
  clearTokens()
  authFailureHandler?.()
}

async function rawJsonRequest(
  path: string,
  options: RequestInit,
): Promise<{ response: Response; data: { message?: string | string[] } | null }> {
  const token = getAccessToken()
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  const text = await response.text()
  const data = text ? (JSON.parse(text) as { message?: string | string[] } | null) : null
  return { response, data }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  let { response, data } = await rawJsonRequest(path, options)

  if (response.status === 401 && getRefreshToken()) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      ;({ response, data } = await rawJsonRequest(path, options))
    } else {
      invalidateSession()
    }
  }

  if (!response.ok) {
    const message = Array.isArray(data?.message) ? data.message.join(', ') : data?.message
    throw new Error(message || `Request failed (${response.status})`)
  }
  return data as T
}

export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const form = new FormData()
  form.append('file', file)
  const token = getAccessToken()

  let response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })

  if (response.status === 401 && getRefreshToken()) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      response = await fetch(`${apiBaseUrl}${path}`, {
        method: 'POST',
        headers: getAccessToken()
          ? { Authorization: `Bearer ${getAccessToken()}` }
          : {},
        body: form,
      })
    } else {
      invalidateSession()
    }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Upload failed (${response.status})`)
  }
  return (await response.json()) as T
}

export type User = { id: string; username: string; email: string }
export type Friendship = { id: string; status: string; friend: User }
export type PendingFriendship = { id: string; requester: User }
export type SharingMode = 'GHOST' | 'EVERYONE' | 'SELECTED' | 'EXCEPT_SELECTED'
export type ChatMessage = {
  id: string
  senderId: string
  recipientId: string
  body: string | null
  imageUrl: string | null
  readAt: string | null
  createdAt: string
  deletedAt: string | null
}
export type Conversation = {
  friendId: string
  friendUsername: string
  friendEmail: string
  lastMessage: ChatMessage | null
  unreadCount: number
  friendOnline: boolean
  friendLastSeen: number | null
}
export type PresenceUpdate = { userId: string; online: boolean; lastSeen: string }
export type PresenceSnapshot = {
  onlineUserIds: string[]
  lastSeenByUserId?: Record<string, number>
}

export type TripStatus = 'DRAFT' | 'DECIDED' | 'ARCHIVED'
export type TripMeetupMode = 'AUTO' | 'FIXED'
export type TripMemberRole = 'ADMIN' | 'MEMBER'

export type Trip = {
  id: string
  name: string
  status: TripStatus
  meetupMode: TripMeetupMode
  meetupLat: number | null
  meetupLng: number | null
  meetupName: string | null
  meetupFixedById: string | null
  meetupProposalById: string | null
  meetupProposalLat: number | null
  meetupProposalLng: number | null
  meetupProposalName: string | null
  meetingTime: string | null
  createdById: string
  createdAt: string
  archivedAt: string | null
}

export type TripListItem = Trip & {
  members: { userId: string; arrivedAt: string | null }[]
  memberCount: number
}

export type TripMember = {
  id: string
  tripId: string
  userId: string
  role: TripMemberRole
  joinedAt: string
  arrivedAt: string | null
  user?: User
}

export type TripInvite = {
  id: string
  tripId: string
  fromId: string
  toId: string
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED'
  createdAt: string
  respondedAt: string | null
  trip?: Trip
  from?: User
}

export type TripMessage = {
  id: string
  tripId: string
  senderId: string
  body: string
  createdAt: string
}

export type TripDetail = Trip & {
  members: TripMember[]
  invites: TripInvite[]
  memberCount?: number
}

export type CreateTripPayload = {
  name: string
  memberIds?: string[]
  meetupLat?: number
  meetupLng?: number
  meetupName?: string
  meetingTime?: string
}

export type SearchResult = ChatMessage

export function searchMessages(q: string, friendId?: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q })
  if (friendId) params.set('friendId', friendId)
  return apiRequest<SearchResult[]>(`/messages/search?${params.toString()}`)
}

export async function deleteMessage(messageId: string): Promise<ChatMessage> {
  return apiRequest<ChatMessage>(`/messages/${messageId}`, { method: 'DELETE' })
}

export async function clearConversation(
  friendId: string,
): Promise<{ deletedCount: number }> {
  return apiRequest<{ deletedCount: number }>(
    `/messages/conversation/${friendId}`,
    { method: 'DELETE' },
  )
}

export function listTrips(): Promise<TripListItem[]> {
  return apiRequest<TripListItem[]>('/trips')
}

export function listTripInvites(): Promise<TripInvite[]> {
  return apiRequest<TripInvite[]>('/trips/invites')
}

export function getTrip(tripId: string): Promise<TripDetail> {
  return apiRequest<TripDetail>(`/trips/${tripId}`)
}

export async function createTrip(
  payload: CreateTripPayload,
): Promise<{ trip: TripDetail; invites: TripInvite[] }> {
  return apiRequest<{ trip: TripDetail; invites: TripInvite[] }>('/trips', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateTrip(
  tripId: string,
  payload: { name?: string; meetingTime?: string | null },
): Promise<Trip> {
  return apiRequest<Trip>(`/trips/${tripId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: payload.name, meetingTime: payload.meetingTime }),
  })
}

export function archiveTrip(tripId: string): Promise<Trip> {
  return apiRequest<Trip>(`/trips/${tripId}/archive`, { method: 'POST' })
}

export function deleteTrip(tripId: string): Promise<{ deleted: boolean }> {
  return apiRequest<{ deleted: boolean }>(`/trips/${tripId}`, { method: 'DELETE' })
}

export function leaveTrip(tripId: string): Promise<{ left: boolean }> {
  return apiRequest<{ left: boolean }>(`/trips/${tripId}/leave`, { method: 'POST' })
}

export function inviteToTrip(tripId: string, friendId: string): Promise<TripInvite> {
  return apiRequest<TripInvite>(`/trips/${tripId}/invites`, {
    method: 'POST',
    body: JSON.stringify({ friendId }),
  })
}

export function respondToInvite(
  inviteId: string,
  accept: boolean,
): Promise<TripInvite> {
  return apiRequest<TripInvite>(`/trips/invites/${inviteId}/respond`, {
    method: 'POST',
    body: JSON.stringify({ accept }),
  })
}

export async function setTripMeetup(
  tripId: string,
  spot: { lat: number; lng: number; name?: string },
): Promise<{ trip: Trip; proposed: boolean }> {
  return apiRequest<{ trip: Trip; proposed: boolean }>(`/trips/${tripId}/meetup`, {
    method: 'POST',
    body: JSON.stringify({ lat: spot.lat, lng: spot.lng, name: spot.name }),
  })
}

export async function respondToMeetupProposal(
  tripId: string,
  accept: boolean,
): Promise<Trip> {
  return apiRequest<Trip>(`/trips/${tripId}/meetup/respond`, {
    method: 'POST',
    body: JSON.stringify({ accept }),
  })
}

export function arriveAtTrip(tripId: string): Promise<TripMember> {
  return apiRequest<TripMember>(`/trips/${tripId}/arrive`, { method: 'POST' })
}

export function getTripMessages(tripId: string): Promise<TripMessage[]> {
  return apiRequest<TripMessage[]>(`/trips/${tripId}/messages`)
}