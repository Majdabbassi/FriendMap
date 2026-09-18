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

export type User = { id: string; username: string; email: string }
export type Friendship = { id: string; status: string; friend: User }
export type PendingFriendship = { id: string; requester: User }
export type SharingMode = 'GHOST' | 'EVERYONE' | 'SELECTED' | 'EXCEPT_SELECTED'
export type ChatMessage = {
  id: string
  senderId: string
  recipientId: string
  body: string | null
  imageContentType: string | null
  imageData: string | null
  readAt: string | null
  createdAt: string
}
export type Conversation = {
  friendId: string
  friendUsername: string
  friendEmail: string
  lastMessage: ChatMessage | null
  unreadCount: number
  friendOnline: boolean
}
export type PresenceUpdate = { userId: string; online: boolean; lastSeen: string }
export type PresenceSnapshot = { onlineUserIds: string[] }