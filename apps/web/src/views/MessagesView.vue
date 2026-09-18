<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { io, type Socket } from 'socket.io-client'
import {
  apiBaseUrl,
  apiRequest,
  getAccessToken,
  type ChatMessage,
  type Conversation,
  type Friendship,
  type PresenceSnapshot,
  type PresenceUpdate,
} from '../api'
import { useAuthStore } from '../stores/auth'
import { usePresenceStore } from '../stores/presence'

const auth = useAuthStore()
const presence = usePresenceStore()

const conversations = ref<Conversation[]>([])
const activeFriendId = ref<string | null>(null)
const messages = ref<ChatMessage[]>([])
const draft = ref('')
const threadEl = ref<HTMLElement | null>(null)

const connection = ref('connecting')
const viewError = ref('')
const threadLoading = ref(false)
const threadError = ref('')
const socketError = ref('')

let socket: Socket | undefined
let socketErrorTimer: ReturnType<typeof setTimeout> | undefined
let scrollScheduled = false

const friendMeta = new Map<string, { username: string; email: string }>()


/* =========================================================
   HELPERS
   ========================================================= */

const activeConversation = computed(() =>
  conversations.value.find((c) => c.friendId === activeFriendId.value),
)

function otherPartyId(message: ChatMessage): string {
  return message.senderId === auth.userId ? message.recipientId : message.senderId
}

function formatChatTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function showSocketError(message: string): void {
  socketError.value = message
  if (socketErrorTimer) clearTimeout(socketErrorTimer)
  socketErrorTimer = setTimeout(() => {
    socketError.value = ''
  }, 4000)
}

function scrollToBottom(): void {
  if (!scrollScheduled) {
    scrollScheduled = true
    void nextTick(() => {
      scrollScheduled = false
      if (threadEl.value) {
        threadEl.value.scrollTop = threadEl.value.scrollHeight
      }
    })
  }
}


/* =========================================================
   READ RECEIPTS
   ========================================================= */

const readInFlight = new Set<string>()

function markRead(friendId: string): void {
  if (readInFlight.has(friendId)) return
  readInFlight.add(friendId)

  const conversation = conversations.value.find((c) => c.friendId === friendId)
  if (conversation) conversation.unreadCount = 0

  void apiRequest(`/messages/${friendId}/read`, { method: 'POST' }).catch(() => {})
  socket?.emit('message:read', { senderId: friendId })

  setTimeout(() => readInFlight.delete(friendId), 1500)
}


/* =========================================================
   MESSAGE HOOKS
   ========================================================= */

function touchConversation(message: ChatMessage): void {
  const friendId = otherPartyId(message)
  const index = conversations.value.findIndex((c) => c.friendId === friendId)
  if (index === -1) return
  const conversation = conversations.value[index]!
  conversations.value.splice(index, 1)
  conversations.value.unshift({ ...conversation, lastMessage: message })
}

function ensureConversation(friendId: string, unreadCount: number): void {
  const existing = conversations.value.find((c) => c.friendId === friendId)
  if (existing) return

  const meta = friendMeta.get(friendId)
  if (!meta) return

  conversations.value.unshift({
    friendId,
    friendUsername: meta.username,
    friendEmail: meta.email,
    lastMessage: null,
    unreadCount,
    friendOnline: false,
  })
}

function handleIncomingMessage(message: ChatMessage): void {
  const isCurrentThread =
    activeFriendId.value !== null && message.senderId === activeFriendId.value
  const tabVisible = document.visibilityState === 'visible'

  if (isCurrentThread && tabVisible) {
    markRead(message.senderId)
    messages.value.push(message)
    scrollToBottom()
  } else {
    const conversation = conversations.value.find(
      (c) => c.friendId === message.senderId,
    )
    if (conversation) conversation.unreadCount += 1
    else ensureConversation(message.senderId, 1)
  }

  touchConversation(message)
}

function handleSentMessage(message: ChatMessage): void {
  if (message.recipientId === activeFriendId.value) {
    messages.value.push(message)
    scrollToBottom()
  }
  ensureConversation(message.recipientId, 0)
  touchConversation(message)
}

function handleReadReceipt({ senderId, readAt }: { senderId: string; readAt: string }): void {
  messages.value.forEach((message) => {
    if (message.senderId === auth.userId && message.recipientId === senderId) {
      message.readAt = readAt
    }
  })
}


/* =========================================================
   CONVERSATION LIST
   ========================================================= */

async function loadConversations(): Promise<void> {
  try {
    conversations.value = await apiRequest<Conversation[]>('/messages')
  } catch (err) {
    viewError.value = err instanceof Error ? err.message : 'Could not load conversations'
  }
}

async function openConversation(friendId: string): Promise<void> {
  activeFriendId.value = friendId
  messages.value = []
  threadError.value = ''
  threadLoading.value = true

  try {
    messages.value = await apiRequest<ChatMessage[]>(`/messages/${friendId}`)
  } catch (err) {
    threadError.value = err instanceof Error ? err.message : 'Could not load conversation'
  } finally {
    threadLoading.value = false
    scrollToBottom()
  }

  markRead(friendId)
}


/* =========================================================
   SENDING
   ========================================================= */

function send(): void {
  const body = draft.value.trim()
  if (!body || !activeFriendId.value || socket?.connected !== true) return
  draft.value = ''
  socket.emit('message:send', { recipientId: activeFriendId.value, body })
}


/* =========================================================
   SOCKET
   ========================================================= */

function connectSocket(): void {
  socket = io(apiBaseUrl, {
    auth: (cb: (data: object) => void) => cb({ token: getAccessToken() }),
  })

  socket.on('connect', () => {
    connection.value = 'live'
    socket?.emit('presence:snapshot')
    void loadConversations().then(() => {
      if (activeFriendId.value) void openConversation(activeFriendId.value)
    })
  })

  socket.on('disconnect', () => {
    connection.value = 'offline'
  })

  socket.on('message:new', handleIncomingMessage)
  socket.on('message:sent', handleSentMessage)
  socket.on('message:read', handleReadReceipt)
  socket.on('presence:update', (update: PresenceUpdate) => {
    if (update.online) presence.setOnline(update.userId)
    else presence.setOffline(update.userId)
  })
  socket.on('presence:snapshot', (snapshot: PresenceSnapshot) => {
    presence.applySnapshot(snapshot.onlineUserIds)
  })
  socket.on('message:error', ({ message }: { message: string }) => {
    showSocketError(message)
  })
}

async function loadFriendsMeta(): Promise<void> {
  try {
    const friendships = await apiRequest<Friendship[]>('/friendships')
    for (const item of friendships) {
      friendMeta.set(item.friend.id, {
        username: item.friend.username,
        email: item.friend.email,
      })
    }
  } catch {
    // Conversations will still render from the message list itself.
  }
}

onMounted(() => {
  connectSocket()
  void loadFriendsMeta().then(() => loadConversations()).then(() => {
    if (conversations.value.length > 0) {
      void openConversation(conversations.value[0]!.friendId)
    }
  })
})

onBeforeUnmount(() => {
  if (socketErrorTimer) clearTimeout(socketErrorTimer)
  socket?.disconnect()
  socket = undefined
})
</script>

<template>
  <section class="page messages-page">
    <div class="page-heading">
      <div>
        <p class="eyebrow">CONVERSATIONS</p>
        <h1>Messages</h1>
      </div>
      <span class="status">
        <i :class="connection"></i>
        {{ connection }}
      </span>
    </div>

    <p v-if="viewError" class="error">{{ viewError }}</p>

    <div class="messages-layout">
      <aside class="panel conversations-panel">
        <h2>Conversations</h2>

        <div v-if="!conversations.length" class="empty">
          No conversations yet. Message a friend and it will show up here.
        </div>

        <div
          v-for="conversation in conversations"
          :key="conversation.friendId"
          class="conversation-row"
          :class="{ active: conversation.friendId === activeFriendId }"
          role="button"
          tabindex="0"
          @click="openConversation(conversation.friendId)"
          @keydown.enter="openConversation(conversation.friendId)"
        >
          <div class="conversation-avatar">
            {{ conversation.friendUsername.charAt(0).toUpperCase() }}
            <i
              class="presence-dot"
              :class="presence.isOnline(conversation.friendId) ? 'online' : 'offline'"
            ></i>
          </div>

          <div class="conversation-info">
            <span class="conversation-name">{{ conversation.friendUsername }}</span>
            <span class="conversation-preview">
              {{
                conversation.lastMessage
                  ? `${conversation.lastMessage.senderId === auth.userId ? 'You: ' : ''}${conversation.lastMessage.body}`
                  : 'No messages yet'
              }}
            </span>
          </div>

          <div class="conversation-meta">
            <span v-if="conversation.lastMessage" class="conversation-time">
              {{ formatChatTime(conversation.lastMessage.createdAt) }}
            </span>
            <span v-if="conversation.unreadCount > 0" class="conversation-meta">
              <span class="unread-badge">{{ conversation.unreadCount }}</span>
            </span>
          </div>
        </div>
      </aside>

      <section class="panel thread-panel">
        <template v-if="activeFriendId">
          <div class="thread-header">
            <div class="conversation-avatar">
              {{ activeConversation?.friendUsername.charAt(0).toUpperCase() }}
              <i
                class="presence-dot"
                :class="presence.isOnline(activeFriendId) ? 'online' : 'offline'"
              ></i>
            </div>
            <div class="conversation-info">
              <span class="conversation-name">
                {{ activeConversation?.friendUsername }}
              </span>
              <span class="conversation-preview">
                {{
                  presence.isOnline(activeFriendId)
                    ? 'Online'
                    : 'Offline'
                }}
              </span>
            </div>
          </div>

          <div ref="threadEl" class="thread-scroll">
            <div v-if="threadLoading" class="empty">Loading…</div>
            <p v-else-if="threadError" class="error">{{ threadError }}</p>

            <div
              v-for="message in messages"
              :key="message.id"
              class="message-row"
              :class="{ own: message.senderId === auth.userId }"
            >
              <div class="message-bubble">
                <span>{{ message.body }}</span>
                <span class="message-meta">
                  {{ formatChatTime(message.createdAt) }}
                  <span v-if="message.senderId === auth.userId">
                    <template v-if="message.readAt">read</template>
                    <template v-else>sent</template>
                  </span>
                </span>
              </div>
            </div>

            <div v-if="!threadLoading && !messages.length" class="empty">
              Say hello! This is the start of your conversation.
            </div>
          </div>

          <form class="message-composer" @submit.prevent="send">
            <input
              v-model="draft"
              maxlength="2000"
              placeholder="Write a message…"
              autocomplete="off"
            />
            <button
              class="button primary"
              type="submit"
              :disabled="!draft.trim()"
            >
              Send
            </button>
          </form>
        </template>

        <div v-else class="empty thread-placeholder">
          Select a conversation to start chatting.
        </div>
      </section>
    </div>

    <div v-if="socketError" class="toast chat-toast">
      {{ socketError }}
    </div>
  </section>
</template>