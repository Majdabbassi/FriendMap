<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

function logout() {
  auth.logout()
  router.push('/auth')
}
</script>

<template>
  <div class="app-shell">
    <header v-if="auth.isAuthenticated" class="topbar">
      <RouterLink class="brand" to="/map">FRIEND<span>MAP</span></RouterLink>
      <nav>
        <RouterLink to="/map" :class="{ active: route.path === '/map' }">Map</RouterLink>
        <RouterLink to="/friends" :class="{ active: route.path === '/friends' }">Friends</RouterLink>
        <RouterLink to="/sharing" :class="{ active: route.path === '/sharing' }">Sharing</RouterLink>
      </nav>
      <button class="button subtle" @click="logout">Log out</button>
    </header>
    <main :class="{ 'with-nav': auth.isAuthenticated }"><RouterView /></main>
  </div>
</template>
