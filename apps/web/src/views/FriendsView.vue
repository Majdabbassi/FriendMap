<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { apiRequest, type Friendship, type PendingFriendship } from '../api'

const friends = ref<Friendship[]>([])
const pending = ref<PendingFriendship[]>([])
const target = ref('')
const error = ref('')
const message = ref('')

async function load() {
  friends.value = await apiRequest<Friendship[]>('/friendships')
  pending.value = await apiRequest<PendingFriendship[]>('/friendships/pending')
}
async function sendRequest() {
  error.value = ''; message.value = ''
  try { await apiRequest('/friendships/request', { method: 'POST', body: JSON.stringify(target.value.includes('@') ? { targetEmail: target.value } : { targetUsername: target.value }) }); target.value = ''; message.value = 'Request sent.'; await load() }
  catch (err) { error.value = err instanceof Error ? err.message : 'Could not send request' }
}
async function respond(id: string, action: 'accept' | 'reject') { await apiRequest(`/friendships/${id}/${action}`, { method: 'POST' }); await load() }
async function remove(id: string) { await apiRequest(`/friendships/${id}`, { method: 'DELETE' }); await load() }
onMounted(() => load().catch((err) => { error.value = err.message }))
</script>

<template>
  <section class="page"><div class="page-heading"><div><p class="eyebrow">YOUR CIRCLE</p><h1>Friends</h1></div><span class="count">{{ friends.length }} connected</span></div>
  <div class="content-grid"><div class="stack"><div class="panel"><h2>Connected</h2><div v-if="!friends.length" class="empty">No accepted friends yet.</div><div v-for="item in friends" :key="item.id" class="list-row"><div class="avatar">{{ item.friend.username.charAt(0).toUpperCase() }}</div><div><strong>{{ item.friend.username }}</strong><small>{{ item.friend.email }}</small></div><button class="button danger-link" @click="remove(item.id)">Remove</button></div></div>
      <div class="panel"><h2>Add someone</h2><form class="inline-form" @submit.prevent="sendRequest"><input v-model="target" required placeholder="Email or username" /><button class="button primary">Send request</button></form><p v-if="message" class="success">{{ message }}</p><p v-if="error" class="error">{{ error }}</p></div></div>
      <aside class="panel pending-panel"><h2>Incoming requests <span>{{ pending.length }}</span></h2><div v-if="!pending.length" class="empty">Nothing waiting.</div><div v-for="item in pending" :key="item.id" class="pending-row"><strong>{{ item.requester.username }}</strong><small>{{ item.requester.email }}</small><div><button class="button primary small" @click="respond(item.id, 'accept')">Accept</button><button class="button subtle small" @click="respond(item.id, 'reject')">Decline</button></div></div></aside></div>
  </section>
</template>