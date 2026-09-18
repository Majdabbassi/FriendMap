import { ref } from 'vue'
import { defineStore } from 'pinia'

export const usePresenceStore = defineStore('presence', () => {
  const onlineIds = ref(new Set<string>())

  function isOnline(userId: string): boolean {
    return onlineIds.value.has(userId)
  }

  function setOnline(userId: string): void {
    if (onlineIds.value.has(userId)) return
    const next = new Set(onlineIds.value)
    next.add(userId)
    onlineIds.value = next
  }

  function setOffline(userId: string): void {
    if (!onlineIds.value.has(userId)) return
    const next = new Set(onlineIds.value)
    next.delete(userId)
    onlineIds.value = next
  }

  function applySnapshot(ids: string[]): void {
    onlineIds.value = new Set(ids)
  }

  function onlineCount(): number {
    return onlineIds.value.size
  }

  return { onlineIds, isOnline, setOnline, setOffline, applySnapshot, onlineCount }
})