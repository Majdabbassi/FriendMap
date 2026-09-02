import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { apiRequest } from '../api'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('friendmap_token'))
  const isAuthenticated = computed(() => Boolean(token.value))

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

  return { token, isAuthenticated, authenticate, logout }
})