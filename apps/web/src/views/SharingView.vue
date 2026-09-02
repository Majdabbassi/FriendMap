<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { apiRequest, type Friendship, type SharingMode, type User } from '../api'

const modes: SharingMode[] = ['EVERYONE', 'SELECTED', 'EXCEPT_SELECTED', 'GHOST']
const mode = ref<SharingMode>('EVERYONE')
const friends = ref<Friendship[]>([])
const selected = ref(new Set<string>())
const error = ref('')

async function loadList() {
  if (mode.value !== 'SELECTED' && mode.value !== 'EXCEPT_SELECTED') return
  const list = await apiRequest<{ friend: User }[]>(`/sharing/list?type=${mode.value === 'SELECTED' ? 'SELECTED' : 'EXCEPT'}`)
  selected.value = new Set(list.map((entry) => entry.friend.id))
}
async function load() { const settings = await apiRequest<{ mode: SharingMode }>('/sharing/settings'); mode.value = settings.mode; friends.value = await apiRequest<Friendship[]>('/friendships'); await loadList() }
async function changeMode() { await apiRequest('/sharing/settings', { method: 'PATCH', body: JSON.stringify({ mode: mode.value }) }); await loadList() }
async function toggle(friend: User) { const listType = mode.value === 'SELECTED' ? 'SELECTED' : 'EXCEPT'; const isSelected = selected.value.has(friend.id); if (isSelected) { await apiRequest(`/sharing/list/${friend.id}/${listType}`, { method: 'DELETE' }); selected.value.delete(friend.id) } else { await apiRequest('/sharing/list', { method: 'POST', body: JSON.stringify({ friendId: friend.id, listType }) }); selected.value.add(friend.id) } selected.value = new Set(selected.value) }
watch(mode, () => changeMode().catch((err) => { error.value = err.message }))
onMounted(() => load().catch((err) => { error.value = err.message }))
</script>

<template>
  <section class="page narrow"><div class="page-heading"><div><p class="eyebrow">CONTROL YOUR VISIBILITY</p><h1>Sharing</h1></div></div><div class="panel"><h2>Who can see your location?</h2><div class="mode-grid"><label v-for="item in modes" :key="item" class="mode-option" :class="{ active: mode === item }"><input v-model="mode" type="radio" :value="item" /> <span>{{ item }}</span></label></div><p v-if="error" class="error">{{ error }}</p></div><div v-if="mode === 'SELECTED' || mode === 'EXCEPT_SELECTED'" class="panel"><h2>{{ mode === 'SELECTED' ? 'People allowed to see you' : 'People excluded from seeing you' }}</h2><p class="muted">Toggle accepted friends in this list.</p><label v-for="item in friends" :key="item.friend.id" class="check-row"><input type="checkbox" :checked="selected.has(item.friend.id)" @change="toggle(item.friend).catch((err) => { error = err.message })" /><span>{{ item.friend.username }}</span><small>{{ item.friend.email }}</small></label></div></section>
</template>