import { ref } from 'vue'
import { defineStore } from 'pinia'

export const usePresenceStore = defineStore('presence', () => {
  const onlineIds = ref(new Set<string>())
  const lastSeenById = ref<Record<string, number>>({})

  function isOnline(userId: string): boolean {
    return onlineIds.value.has(userId)
  }

  function lastSeen(userId: string): number | undefined {
    return lastSeenById.value[userId]
  }

  function setOnline(userId: string): void {
    if (onlineIds.value.has(userId)) return
    const next = new Set(onlineIds.value)
    next.add(userId)
    onlineIds.value = next
  }

  function setOffline(userId: string): void {
    if (!onlineIds.value.has(userId)) return
    lastSeenById.value = {
      ...lastSeenById.value,
      [userId]: Date.now(),
    }
    const next = new Set(onlineIds.value)
    next.delete(userId)
    onlineIds.value = next
  }

  function setLastSeen(userId: string, timestamp: number): void {
    lastSeenById.value = {
      ...lastSeenById.value,
      [userId]: timestamp,
    }
  }

  function applySnapshot(
    ids: string[],
    lastSeenByUserId?: Record<string, number>,
  ): void {
    onlineIds.value = new Set(ids)
    if (lastSeenByUserId) {
      lastSeenById.value = { ...lastSeenByUserId }
    }
  }

  function onlineCount(): number {
    return onlineIds.value.size
  }

  return {
    onlineIds,
    lastSeenById,
    isOnline,
    lastSeen,
    setOnline,
    setOffline,
    setLastSeen,
    applySnapshot,
    onlineCount,
  }
})