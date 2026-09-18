import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  apiRequest,
  clearTokens,
  getAccessToken,
  setAuthFailureHandler,
  setTokens,
} from '../api'

type JwtPayload = { sub?: string; username?: string }

function decodeToken(token: string | null): JwtPayload | null {
  if (!token) return null
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as JwtPayload
  } catch {
    return null
  }
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref(getAccessToken())
  const isAuthenticated = computed(() => Boolean(token.value))
  const username = computed(() => decodeToken(token.value)?.username ?? '')
  const userId = computed(() => decodeToken(token.value)?.sub ?? '')

  setAuthFailureHandler(() => {
    token.value = null
  })

  async function authenticate(path: '/auth/login' | '/auth/register', body: object) {
    const result = await apiRequest<{ access_token: string; refresh_token: string }>(path, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    setTokens(result)
    token.value = result.access_token
  }

  async function logout() {
    try {
      await apiRequest('/auth/logout', { method: 'POST' })
    } catch {
      // Ignore server errors: the local session must be cleared regardless.
    } finally {
      token.value = null
      clearTokens()
    }
  }

  return { token, isAuthenticated, username, userId, authenticate, logout }
})