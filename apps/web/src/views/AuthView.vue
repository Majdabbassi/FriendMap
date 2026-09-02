<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()
const mode = ref<'login' | 'register'>('login')
const email = ref('')
const username = ref('')
const password = ref('password123')
const error = ref('')
const busy = ref(false)

async function submit() {
  busy.value = true
  error.value = ''
  try {
    await auth.authenticate(`/auth/${mode.value}`, mode.value === 'login'
      ? { email: email.value, password: password.value }
      : { email: email.value, username: username.value, password: password.value })
    router.push('/map')
  } catch (err) { error.value = err instanceof Error ? err.message : 'Request failed' }
  finally { busy.value = false }
}
</script>

<template>
  <section class="auth-layout">
    <div class="auth-intro"><p class="eyebrow">LIVE LOCATION NETWORK</p><h1>Find your people.<br /><em>Keep moving.</em></h1><p class="muted">A small, private map for the people you actually want to find.</p></div>
    <form class="panel auth-card" @submit.prevent="submit">
      <div class="tabs"><button type="button" :class="{ selected: mode === 'login' }" @click="mode = 'login'">Log in</button><button type="button" :class="{ selected: mode === 'register' }" @click="mode = 'register'">Register</button></div>
      <h2>{{ mode === 'login' ? 'Welcome back' : 'Create your account' }}</h2>
      <label>Email<input v-model="email" type="email" required autocomplete="email" placeholder="you@example.com" /></label>
      <label v-if="mode === 'register'">Username<input v-model="username" required minlength="3" placeholder="your_name" /></label>
      <label>Password<input v-model="password" type="password" required minlength="8" autocomplete="current-password" /></label>
      <p v-if="error" class="error">{{ error }}</p>
      <button class="button primary" :disabled="busy">{{ busy ? 'Working...' : mode === 'login' ? 'Enter the map' : 'Create account' }}</button>
    </form>
  </section>
</template>