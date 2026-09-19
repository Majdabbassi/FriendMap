<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { useChatStore } from './stores/chat'

const auth = useAuthStore()
const chat = useChatStore()
const router = useRouter()
const route = useRoute()

const toastMessage = ref('')

watch(
  () => chat.lastMessage,
  (message) => {
    toastMessage.value = message ? `${message.friendUsername}: ${message.body}` : ''
  },
)

async function logout() {
  await auth.logout()
  chat.disconnect()
  chat.reset()
  await router.push('/auth')
}

function openMessages() {
  chat.dismissToast()
  router.push('/messages')
}

onMounted(() => {
  if (auth.isAuthenticated) chat.connect()
  watch(
    () => auth.isAuthenticated,
    (authenticated) => {
      if (authenticated) chat.connect()
    },
  )
})

onBeforeUnmount(() => {
  chat.disconnect()
})
</script>

<template>
  <div class="app-shell">
    <header v-if="auth.isAuthenticated" class="topbar">
      <RouterLink class="brand" to="/map">FRIEND<span>MAP</span></RouterLink>
      <nav>
        <RouterLink to="/map" :class="{ active: route.path === '/map' }">Map</RouterLink>
        <RouterLink to="/friends" :class="{ active: route.path === '/friends' }">Friends</RouterLink>
        <RouterLink to="/messages" :class="{ active: route.path === '/messages' }">
          Messages
          <span v-if="chat.unreadCount() > 0" class="nav-badge">{{ chat.unreadCount() }}</span>
        </RouterLink>
        <RouterLink to="/sharing" :class="{ active: route.path === '/sharing' }">Sharing</RouterLink>
        <RouterLink to="/trips" :class="{ active: route.path.startsWith('/trips') }">Trips</RouterLink>
      </nav>
      <span class="identity">Logged in as: {{ auth.username }}</span>
      <button class="button subtle" @click="logout">Log out</button>
    </header>
    <main :class="{ 'with-nav': auth.isAuthenticated }"><RouterView /></main>

    <Transition name="toast">
      <button v-if="toastMessage" class="app-toast" type="button" @click="openMessages">
        <span class="app-toast-label">New message</span>
        <span class="app-toast-text">{{ toastMessage }}</span>
      </button>
    </Transition>
  </div>
</template>