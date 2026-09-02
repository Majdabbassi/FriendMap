export const apiBaseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '')

export async function apiRequest<T>(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem('friendmap_token')
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
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