import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePresenceStore } from '../stores/presence'

describe('presence store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts with nobody online', () => {
    const store = usePresenceStore()
    expect(store.isOnline('alice')).toBe(false)
    expect(store.onlineCount()).toBe(0)
  })

  it('tracks users coming online and going offline', () => {
    const store = usePresenceStore()
    store.setOnline('bob')
    store.setOnline('carol')
    expect(store.isOnline('bob')).toBe(true)
    expect(store.isOnline('carol')).toBe(true)
    expect(store.onlineCount()).toBe(2)

    store.setOffline('bob')
    expect(store.isOnline('bob')).toBe(false)
    expect(store.isOnline('carol')).toBe(true)
    expect(store.onlineCount()).toBe(1)
  })

  it('replaces the full online list on snapshot', () => {
    const store = usePresenceStore()
    store.setOnline('bob')
    store.applySnapshot(['carol', 'erin'])
    expect(store.isOnline('bob')).toBe(false)
    expect(store.isOnline('carol')).toBe(true)
    expect(store.isOnline('erin')).toBe(true)
    expect(store.onlineCount()).toBe(2)
  })

  it('is idempotent for duplicate presence updates', () => {
    const store = usePresenceStore()
    store.setOnline('bob')
    store.setOnline('bob')
    store.setOffline('bob')
    store.setOffline('bob')
    expect(store.onlineCount()).toBe(0)
  })

  it('records a last-seen timestamp when a user goes offline', () => {
    const store = usePresenceStore()
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
      store.setOnline('bob')
      store.setOffline('bob')
      expect(store.lastSeen('bob')).toBe(new Date('2026-01-01T12:00:00Z').getTime())
    } finally {
      vi.useRealTimers()
    }
  })

  it('exposes explicit last-seen values', () => {
    const store = usePresenceStore()
    expect(store.lastSeen('bob')).toBeUndefined()
    store.setLastSeen('bob', 111)
    expect(store.lastSeen('bob')).toBe(111)
  })

  it('keeps last-seen info from a snapshot alongside the online list', () => {
    const store = usePresenceStore()
    store.applySnapshot(['bob', 'carol'], { bob: 111, carol: 222 })
    expect(store.isOnline('bob')).toBe(true)
    expect(store.isOnline('carol')).toBe(true)
    expect(store.lastSeen('bob')).toBe(111)
    expect(store.lastSeen('carol')).toBe(222)
  })
})