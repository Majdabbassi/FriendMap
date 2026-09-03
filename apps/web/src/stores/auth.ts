import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { apiRequest } from '../api'

type JwtPayload = { username?: string }

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
  const token = ref(localStorage.getItem('friendmap_token'))
  const isAuthenticated = computed(() => Boolean(token.value))
  const username = computed(() => decodeToken(token.value)?.username ?? '')

  async function authenticate(path: '/auth/login' | '/auth/register', body: object) {
    const result = await apiRequest<{ access_token: string }>(path, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    token.value = result.access_token
    localStorage.setItem('friendmap_token', result.access_token)
  }

  function logout() {
    token.value = null
    localStorage.removeItem('friendmap_token')
  }

  return { token, isAuthenticated, username, authenticate, logout }
})