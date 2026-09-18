import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '../stores/auth'
import * as api from '../api'

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('reports unauthenticated when no token is stored', () => {
    const store = useAuthStore()

    expect(store.isAuthenticated).toBe(false)
    expect(store.username).toBe('')
  })

  it('authenticates by storing the returned tokens', async () => {
    const spy = vi.spyOn(api, 'apiRequest').mockResolvedValue({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    })
    const store = useAuthStore()

    await store.authenticate('/auth/login', { identifier: 'alice', password: 'password123' })

    expect(spy).toHaveBeenCalledWith('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: 'alice', password: 'password123' }),
    })
    expect(store.isAuthenticated).toBe(true)
    expect(api.getAccessToken()).toBe('access-token')
    expect(api.getRefreshToken()).toBe('refresh-token')
  })

  it('decodes the username from the JWT payload', () => {
    const payload = btoa(JSON.stringify({ username: 'alice' }))
    localStorage.setItem('friendmap_token', `h.${payload}.s`)

    const store = useAuthStore()

    expect(store.isAuthenticated).toBe(true)
    expect(store.username).toBe('alice')
  })

  it('clears the session on logout even when the server call fails', async () => {
    vi.spyOn(api, 'apiRequest').mockRejectedValue(new Error('network down'))
    localStorage.setItem('friendmap_token', 'access-token')
    localStorage.setItem('friendmap_refresh_token', 'refresh-token')
    const store = useAuthStore()

    await store.logout()

    expect(store.isAuthenticated).toBe(false)
    expect(api.getAccessToken()).toBeNull()
    expect(api.getRefreshToken()).toBeNull()
  })
})