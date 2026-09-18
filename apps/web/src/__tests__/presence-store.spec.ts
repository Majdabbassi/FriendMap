import { describe, it, expect, beforeEach } from 'vitest'
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
})