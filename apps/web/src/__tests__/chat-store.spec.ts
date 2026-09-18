import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChatStore } from '../stores/chat'
import type { ChatMessage } from '../api'

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    senderId: 'bob',
    recipientId: 'me',
    body: 'hello',
    imageUrl: null,
    readAt: null,
    createdAt: new Date().toISOString(),
    deletedAt: null,
    ...overrides,
  }
}

describe('chat store', () => {
  let originalVisibility: string

  beforeEach(() => {
    setActivePinia(createPinia())
    originalVisibility = document.visibilityState
  })

  afterEach(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: originalVisibility,
    })
    vi.restoreAllMocks()
  })

  function setVisibility(state: string): void {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: state,
    })
  }

  it('counts distinct conversations with unread messages', () => {
    const store = useChatStore()
    setVisibility('hidden')

    store.handleIncoming(message({ senderId: 'bob' }))
    store.handleIncoming(message({ senderId: 'bob', id: 'm2' }))
    store.handleIncoming(message({ senderId: 'carol', id: 'm3' }))

    expect(store.unreadCount()).toBe(2)
  })

  it('shows a toast naming the sender and latest contents', () => {
    const store = useChatStore()
    setVisibility('hidden')

    store.handleIncoming(message({ senderId: 'bob', body: 'check this' }))

    expect(store.lastMessage).toEqual({
      friendId: 'bob',
      friendUsername: 'a friend',
      body: 'check this',
    })
  })

  it('falls back to a Photo label for image-only messages', () => {
    const store = useChatStore()
    setVisibility('hidden')

    store.handleIncoming(
      message({
        senderId: 'bob',
        body: null,
        imageUrl: '/uploads/6b29fc40-1111-2222-3333-444455556666.png',
      }),
    )

    expect(store.lastMessage?.body).toBe('📷 Photo')
  })

  it('does not count or toast messages for the actively viewed thread', () => {
    const store = useChatStore()
    setVisibility('visible')
    store.setOpenThread('bob')

    store.handleIncoming(message({ senderId: 'bob' }))

    expect(store.unreadCount()).toBe(0)
    expect(store.lastMessage).toBeNull()
  })

  it('counts new messages for other friends while a thread is open', () => {
    const store = useChatStore()
    setVisibility('visible')
    store.setOpenThread('bob')

    store.handleIncoming(message({ senderId: 'carol', id: 'm2' }))

    expect(store.unreadCount()).toBe(1)
  })

  it('markRead clears only that friend from the unread count', () => {
    const store = useChatStore()
    setVisibility('hidden')
    store.handleIncoming(message({ senderId: 'bob' }))
    store.handleIncoming(message({ senderId: 'carol', id: 'm2' }))

    store.markRead('bob')

    expect(store.unreadCount()).toBe(1)
    expect(store.unreadFriendIds).toEqual(['carol'])
  })

  it('syncs unread state from the persisted conversation list', () => {
    const store = useChatStore()
    store.syncFromConversations([
      {
        friendId: 'bob',
        friendUsername: 'bob',
        friendEmail: 'bob@friendmap.dev',
        lastMessage: null,
        unreadCount: 3,
        friendOnline: true,
        friendLastSeen: null,
      },
      {
        friendId: 'carol',
        friendUsername: 'carol',
        friendEmail: 'carol@friendmap.dev',
        lastMessage: null,
        unreadCount: 0,
        friendOnline: false,
        friendLastSeen: null,
      },
    ])

    expect(store.unreadCount()).toBe(1)
    expect(store.unreadFriendIds).toEqual(['bob'])
  })

  it('uses the friend username from the seeded friendships list', async () => {
    const store = useChatStore()
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify([
            { id: 'f1', status: 'ACCEPTED', friend: { id: 'bob', username: 'bob' } },
          ]),
          { status: 200 },
        ),
      )

    await store.seed()
    fetchMock.mockClear()

    setVisibility('hidden')
    store.handleIncoming(message({ senderId: 'bob' }))

    expect(store.lastMessage?.friendUsername).toBe('bob')
  })

  it('reset clears counts, threads, and toasts', () => {
    const store = useChatStore()
    setVisibility('hidden')
    store.handleIncoming(message({ senderId: 'bob' }))
    store.setOpenThread('bob')

    store.reset()

    expect(store.unreadCount()).toBe(0)
    expect(store.openThreadFriendId).toBeNull()
    expect(store.lastMessage).toBeNull()
  })

  it('tracks which friends are currently typing', () => {
    const store = useChatStore()
    expect(store.isTyping('bob')).toBe(false)

    store.setTyping('bob', true)
    store.setTyping('carol', true)
    expect(store.isTyping('bob')).toBe(true)
    expect(store.isTyping('carol')).toBe(true)
    expect(store.typingFriendIds).toEqual(new Set(['bob', 'carol']))

    store.setTyping('bob', false)
    expect(store.isTyping('bob')).toBe(false)
    expect(store.isTyping('carol')).toBe(true)
  })

  it('drops typing flags on reset', () => {
    const store = useChatStore()
    store.setTyping('bob', true)
    store.setTyping('carol', true)

    store.reset()

    expect(store.isTyping('bob')).toBe(false)
    expect(store.isTyping('carol')).toBe(false)
  })
})