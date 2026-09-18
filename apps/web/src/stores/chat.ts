import { ref } from 'vue'
import { defineStore } from 'pinia'
import { io, type Socket } from 'socket.io-client'
import {
  apiBaseUrl,
  apiRequest,
  getAccessToken,
  type ChatMessage,
  type Conversation,
  type Friendship,
} from '../api'

export const CHAT_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024

export const useChatStore = defineStore('chat', () => {
  const unreadFriendIds = ref<string[]>([])
  const lastMessage = ref<{
    friendId: string
    friendUsername: string
    body: string
  } | null>(null)
  const openThreadFriendId = ref<string | null>(null)
  const typingFriendIds = ref(new Set<string>())

  const friendUsernames: Record<string, string> = {}
  let socket: Socket | undefined
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  let toastCounter = 0

  function unreadCount(): number {
    return unreadFriendIds.value.length
  }

  function setOpenThread(friendId: string | null): void {
    openThreadFriendId.value = friendId
  }

  function isTyping(friendId: string): boolean {
    return typingFriendIds.value.has(friendId)
  }

  function setTyping(friendId: string, typing: boolean): void {
    if (typing === typingFriendIds.value.has(friendId)) return
    const next = new Set(typingFriendIds.value)
    if (typing) next.add(friendId)
    else next.delete(friendId)
    typingFriendIds.value = next
  }

  function markRead(friendId: string): void {
    unreadFriendIds.value = unreadFriendIds.value.filter((id) => id !== friendId)
  }

  function syncFromConversations(conversations: Conversation[]): void {
    unreadFriendIds.value = conversations
      .filter((c) => c.unreadCount > 0)
      .map((c) => c.friendId)
  }

  function showToast(friendId: string, friendUsername: string, body: string): void {
    lastMessage.value = { friendId, friendUsername, body }
    if (toastTimer) clearTimeout(toastTimer)
    const id = ++toastCounter
    toastTimer = setTimeout(() => {
      if (toastCounter === id) lastMessage.value = null
      toastTimer = undefined
    }, 5000)
  }

  function dismissToast(): void {
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = undefined
    lastMessage.value = null
  }

  function handleIncoming(message: ChatMessage): void {
    const viewingThread =
      document.visibilityState === 'visible' &&
      message.senderId === openThreadFriendId.value
    if (viewingThread) return

    if (!unreadFriendIds.value.includes(message.senderId)) {
      unreadFriendIds.value = [...unreadFriendIds.value, message.senderId]
    }

    showToast(
      message.senderId,
      friendUsernames[message.senderId] ?? 'a friend',
      message.body ?? '📷 Photo',
    )
  }

  async function seed(): Promise<void> {
    try {
      const friendships = await apiRequest<Friendship[]>('/friendships')
      for (const item of friendships) {
        friendUsernames[item.friend.id] = item.friend.username
      }
    } catch {
      // Toast falls back to "a friend" when the list is unavailable.
    }

    try {
      syncFromConversations(await apiRequest<Conversation[]>('/messages'))
    } catch {
      // Unread counts will still pick up live messages.
    }
  }

  function connect(): void {
    if (socket) return
    socket = io(apiBaseUrl, {
      auth: (cb: (data: object) => void) => cb({ token: getAccessToken() }),
    })
    socket.on('connect', () => {
      void seed()
    })
    socket.on('message:new', (message: ChatMessage) => handleIncoming(message))
  }

  function disconnect(): void {
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = undefined
    socket?.disconnect()
    socket = undefined
  }

  function reset(): void {
    unreadFriendIds.value = []
    openThreadFriendId.value = null
    lastMessage.value = null
    typingFriendIds.value = new Set()
  }

  return {
    unreadFriendIds,
    lastMessage,
    openThreadFriendId,
    typingFriendIds,
    unreadCount,
    setOpenThread,
    markRead,
    isTyping,
    setTyping,
    syncFromConversations,
    showToast,
    dismissToast,
    handleIncoming,
    seed,
    connect,
    disconnect,
    reset,
  }
})