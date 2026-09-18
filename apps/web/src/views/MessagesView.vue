<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { io, type Socket } from 'socket.io-client'
import {
  apiBaseUrl,
  apiRequest,
  apiUpload,
  getAccessToken,
  clearConversation,
  deleteMessage,
  searchMessages,
  type ChatMessage,
  type Conversation,
  type Friendship,
  type PresenceSnapshot,
  type PresenceUpdate,
} from '../api'
import { useAuthStore } from '../stores/auth'
import { usePresenceStore } from '../stores/presence'
import { CHAT_IMAGE_TYPES, MAX_IMAGE_BYTES, useChatStore } from '../stores/chat'

const auth = useAuthStore()
const presence = usePresenceStore()
const chat = useChatStore()

const conversations = ref<Conversation[]>([])
const friends = ref<Friendship[]>([])
const activeFriendId = ref<string | null>(null)
const messages = ref<ChatMessage[]>([])
const draft = ref('')
const threadEl = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const imagePending = ref<{ file: File; preview: string; name: string } | null>(null)
const sending = ref(false)

const showFriendPicker = ref(false)
const friendSearch = ref('')

const connection = ref('connecting')
const viewError = ref('')
const threadLoading = ref(false)
const threadError = ref('')
const socketError = ref('')

const searchQuery = ref('')
const searchResults = ref<ChatMessage[]>([])
const searchOpen = ref(false)

let socket: Socket | undefined
let socketErrorTimer: ReturnType<typeof setTimeout> | undefined
let searchDebounce: ReturnType<typeof setTimeout> | undefined
let typingEmitTimer: ReturnType<typeof setTimeout> | undefined
let scrollScheduled = false

const friendMeta = new Map<string, { username: string; email: string }>()


/* =========================================================
   HELPERS
   ========================================================= */

const activeConversation = computed(() =>
  conversations.value.find((c) => c.friendId === activeFriendId.value),
)

const activeFriendName = computed(
  () =>
    activeConversation.value?.friendUsername ??
    (activeFriendId.value
      ? friendMeta.get(activeFriendId.value)?.username ?? 'Unknown'
      : ''),
)

const pickerFriends = computed(() => {
  const query = friendSearch.value.trim().toLowerCase()
  const inConversation = new Set(conversations.value.map((c) => c.friendId))
  return friends.value.filter((item) => {
    if (inConversation.has(item.friend.id)) return false
    if (!query) return true
    return (
      item.friend.username.toLowerCase().includes(query) ||
      item.friend.email.toLowerCase().includes(query)
    )
  })
})

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

function conversationPreview(message: ChatMessage | null): string {
  if (!message) return 'No messages yet'
  const base = message.body ?? (message.imageUrl ? '📷 Photo' : '')
  return `${message.senderId === auth.userId ? 'You: ' : ''}${base}`
}

function imageSrc(message: ChatMessage): string {
  return `${apiBaseUrl}${message.imageUrl}`
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
  chat.markRead(friendId)

  void apiRequest(`/messages/${friendId}/read`, { method: 'POST' }).catch(() => {})
  socket?.emit('message:read', { senderId: friendId })

  setTimeout(() => readInFlight.delete(friendId), 1500)
}


/* =========================================================
   CONVERSATION SEARCH
   ========================================================= */

async function runSearch(): Promise<void> {
  const q = searchQuery.value.trim()
  if (q.length < 2) {
    searchResults.value = []
    searchOpen.value = false
    return
  }
  try {
    searchResults.value = await searchMessages(q)
    searchOpen.value = true
  } catch {
    searchResults.value = []
    searchOpen.value = false
  }
}

function onSearchInput(): void {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    void runSearch()
  }, 250)
}

function clearSearch(): void {
  searchQuery.value = ''
  searchResults.value = []
  searchOpen.value = false
}

async function openSearchResult(message: ChatMessage): Promise<void> {
  const friendId = otherPartyId(message)
  clearSearch()
  ensureConversation(friendId, 0)
  await openConversation(friendId)
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
    friendLastSeen: null,
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
   TYPING, DELETE & CLEAR
   ========================================================= */

function emitTyping(typing: boolean): void {
  if (!activeFriendId.value || socket?.connected !== true) return
  socket.emit('typing:update', { friendId: activeFriendId.value, typing })
}

function handleDraftInput(): void {
  if (typingEmitTimer) {
    clearTimeout(typingEmitTimer)
    typingEmitTimer = undefined
  }
  if (activeFriendId.value && draft.value.trim()) {
    emitTyping(true)
  }
  typingEmitTimer = setTimeout(() => emitTyping(false), 1200)
}

function lastSeenText(friendId: string): string {
  const conversation = conversations.value.find((c) => c.friendId === friendId)
  const stamp =
    presence.lastSeen(friendId) ?? conversation?.friendLastSeen ?? null
  if (stamp == null) return 'Offline'
  const date = new Date(stamp)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return `Last seen today at ${date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })}`
  }
  return `Last seen ${date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })}`
}

async function removeMessage(message: ChatMessage): Promise<void> {
  if (message.senderId !== auth.userId) return
  try {
    const deleted = await deleteMessage(message.id)
    const updated = messages.value.map((m) =>
      m.id === message.id ? deleted : m,
    )
    messages.value = updated
    const conversation = conversations.value.find(
      (c) => c.friendId === otherPartyId(message),
    )
    if (conversation && conversation.lastMessage?.id === message.id) {
      conversation.lastMessage = deleted
    }
  } catch (err) {
    showSocketError(
      err instanceof Error ? err.message : 'Sorry, the message could not be deleted',
    )
  }
}

async function clearThread(): Promise<void> {
  const friendId = activeFriendId.value
  if (!friendId) return
  if (!window.confirm('Clear this conversation for everyone?')) return

  try {
    await clearConversation(friendId)
    messages.value = []
    const conversation = conversations.value.find((c) => c.friendId === friendId)
    if (conversation) conversation.lastMessage = null
  } catch (err) {
    showSocketError(
      err instanceof Error ? err.message : 'Sorry, the conversation could not be cleared',
    )
  }
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
  chat.setOpenThread(friendId)
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
   NEW CONVERSATION
   ========================================================= */

function openFriendPicker(): void {
  friendSearch.value = ''
  showFriendPicker.value = true
  void nextTick(() => searchInput.value?.focus())
}

function closeFriendPicker(): void {
  showFriendPicker.value = false
}

function startConversation(friendId: string): void {
  closeFriendPicker()
  if (!conversations.value.some((c) => c.friendId === friendId)) {
    ensureConversation(friendId, 0)
  }
  void openConversation(friendId)
}


/* =========================================================
   SENDING
   ========================================================= */

async function send(): Promise<void> {
  if (!activeFriendId.value || socket?.connected !== true) return
  if (sending.value) return
  const body = draft.value.trim()
  const image = imagePending.value
  if (!body && !image) return

  sending.value = true
  try {
    let imageUrl: string | undefined
    if (image) {
      const uploaded = await apiUpload<{ url: string }>(
        '/messages/attachments',
        image.file,
      )
      imageUrl = uploaded.url
    }

    const payload: Record<string, string> = { recipientId: activeFriendId.value }
    if (body) payload.body = body
    if (imageUrl) payload.imageUrl = imageUrl

    draft.value = ''
    clearImagePending()
    socket.emit('message:send', payload)
  } catch (err) {
    showSocketError(
      err instanceof Error ? err.message : 'Sorry, the image could not be sent',
    )
  } finally {
    sending.value = false
  }
}

function clearImagePending(): void {
  if (imagePending.value?.preview) {
    URL.revokeObjectURL(imagePending.value.preview)
  }
  imagePending.value = null
}

async function onImagePicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  if (!(CHAT_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    showSocketError('Only PNG, JPEG, GIF, and WebP images are supported')
    return
  }
  if (file.size > MAX_IMAGE_BYTES) {
    showSocketError('Images must be 3 MB or smaller')
    return
  }

  clearImagePending()
  imagePending.value = {
    file,
    preview: URL.createObjectURL(file),
    name: file.name,
  }
}

function removeImage(): void {
  clearImagePending()
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
      if (activeFriendId.value) {
        if (!conversations.value.some((c) => c.friendId === activeFriendId.value)) {
          ensureConversation(activeFriendId.value, 0)
        }
        void openConversation(activeFriendId.value)
      }
    })
  })

  socket.on('disconnect', () => {
    connection.value = 'offline'
  })

  socket.on('message:new', handleIncomingMessage)
  socket.on('message:sent', handleSentMessage)
  socket.on('message:read', handleReadReceipt)
  socket.on('message:deleted', (deleted: ChatMessage) => {
    const existing = messages.value.find((m) => m.id === deleted.id)
    if (existing) existing.deletedAt = deleted.deletedAt
  })
  socket.on(
    'conversation:cleared',
    ({ friendId }: { friendId: string }) => {
      if (activeFriendId.value === friendId) messages.value = []
      const conversation = conversations.value.find(
        (c) => c.friendId === friendId,
      )
      if (conversation) conversation.lastMessage = null
    },
  )
  socket.on(
    'typing:update',
    ({ friendId, typing }: { friendId: string; typing: boolean }) => {
      chat.setTyping(friendId, typing)
    },
  )
  socket.on('presence:update', (update: PresenceUpdate) => {
    if (update.online) presence.setOnline(update.userId)
    else presence.setOffline(update.userId)
  })
  socket.on('presence:snapshot', (snapshot: PresenceSnapshot) => {
    presence.applySnapshot(snapshot.onlineUserIds, snapshot.lastSeenByUserId)
  })
  socket.on('message:error', ({ message }: { message: string }) => {
    showSocketError(message)
  })
}

async function loadFriendsMeta(): Promise<void> {
  try {
    const friendships = await apiRequest<Friendship[]>('/friendships')
    friends.value = friendships
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
  if (searchDebounce) clearTimeout(searchDebounce)
  if (typingEmitTimer) clearTimeout(typingEmitTimer)
  clearImagePending()
  emitTyping(false)
  chat.setOpenThread(null)
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
        <div class="conversations-head">
          <h2>Conversations</h2>
          <button
            class="button subtle small"
            type="button"
            @click="openFriendPicker"
          >
            + New
          </button>
        </div>

        <div class="conversation-search">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search messages…"
            autocomplete="off"
            @input="onSearchInput"
            @focus="searchOpen = true"
            @keydown.esc="clearSearch"
          />
          <button
            v-if="searchQuery"
            class="friend-card-close"
            type="button"
            aria-label="Clear search"
            @click="clearSearch"
          >
            ×
          </button>
        </div>

        <div v-if="searchOpen" class="conversation-search-list">
          <p v-if="searchQuery.trim().length < 2" class="hint">
            Type at least 2 characters to search.
          </p>
          <p v-else-if="!searchResults.length" class="hint">No matches.</p>
          <div
            v-for="result in searchResults"
            :key="result.id"
            class="list-row search-row"
            role="button"
            tabindex="0"
            @click="openSearchResult(result)"
            @keydown.enter="openSearchResult(result)"
          >
            <div class="conversation-avatar">
              {{
                friendMeta.get(otherPartyId(result))?.username
                  ?.charAt(0)
                  .toUpperCase() ?? '?'
              }}
            </div>
            <div class="conversation-info">
              <span class="conversation-name">
                {{
                  friendMeta.get(otherPartyId(result))?.username ?? 'Unknown'
                }}
              </span>
              <span class="conversation-preview">
                {{ conversationPreview(result) }}
              </span>
            </div>
          </div>
        </div>

        <div v-if="!conversations.length" class="empty">
          <p>No conversations yet.</p>
          <button
            class="button secondary small empty-cta"
            type="button"
            @click="openFriendPicker"
          >
            Message a friend
          </button>
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
              <span v-if="chat.isTyping(conversation.friendId)" class="typing-hint">
                typing…
              </span>
              <span v-else-if="conversation.lastMessage?.deletedAt">
                Message deleted
              </span>
              <span v-else>
                {{ conversationPreview(conversation.lastMessage) }}
              </span>
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
              {{ activeFriendName.charAt(0).toUpperCase() }}
              <i
                class="presence-dot"
                :class="presence.isOnline(activeFriendId) ? 'online' : 'offline'"
              ></i>
            </div>
            <div class="conversation-info">
              <span class="conversation-name">
                {{ activeFriendName }}
              </span>
              <span class="conversation-preview">
                <span v-if="chat.isTyping(activeFriendId)" class="typing-hint">
                  typing…
                </span>
                <span v-else-if="presence.isOnline(activeFriendId)">
                  Online
                </span>
                <span v-else>
                  {{ lastSeenText(activeFriendId) }}
                </span>
              </span>
            </div>
            <button
              class="button subtle small"
              type="button"
              :disabled="!messages.length"
              title="Clear conversation for everyone"
              @click="clearThread"
            >
              Clear
            </button>
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
              <button
                v-if="
                  message.senderId === auth.userId &&
                  !message.deletedAt
                "
                class="message-delete"
                type="button"
                title="Delete for everyone"
                @click="removeMessage(message)"
              >
                ×
              </button>
              <div
                class="message-bubble"
                :class="{ deleted: message.deletedAt }"
              >
                <template v-if="message.deletedAt">
                  <span class="message-deleted-text">Message deleted</span>
                </template>
                <template v-else>
                  <img
                    v-if="message.imageUrl"
                    :src="imageSrc(message)"
                    class="message-image"
                    :alt="message.body ?? 'Photo message'"
                  />
                  <span v-if="message.body">{{ message.body }}</span>
                  <span class="message-meta">
                    {{ formatChatTime(message.createdAt) }}
                    <span v-if="message.senderId === auth.userId">
                      <template v-if="message.readAt">read</template>
                      <template v-else>sent</template>
                    </span>
                  </span>
                </template>
              </div>
            </div>

            <div v-if="!threadLoading && !messages.length" class="empty">
              Say hello! This is the start of your conversation.
            </div>
          </div>

          <form class="message-composer" @submit.prevent="send">
            <div v-if="imagePending" class="image-chip">
              <img :src="imagePending.preview" alt="" class="image-chip-thumb" />
              <span class="image-chip-name">{{ imagePending.name }}</span>
              <button
                class="friend-card-close"
                type="button"
                aria-label="Remove image"
                @click="removeImage"
              >
                ×
              </button>
            </div>
            <input
              v-model="draft"
              maxlength="2000"
              placeholder="Write a message…"
              autocomplete="off"
              @input="handleDraftInput"
            />
            <button
              class="button subtle attach-button"
              type="button"
              aria-label="Attach an image"
              title="Attach an image (PNG, JPEG, GIF, WebP, up to 3 MB)"
              :disabled="connection !== 'live'"
              @click="fileInput?.click()"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  d="M4 6h16v12H4z"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                />
                <circle cx="9" cy="10" r="1.5" fill="currentColor" />
                <path
                  d="M4 16l4-4 3 3 3-4 6 6"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                />
              </svg>
            </button>
            <input
              ref="fileInput"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              class="hidden-input"
              @change="onImagePicked"
            />
            <button
              class="button primary"
              type="submit"
              :disabled="
                (!draft.trim() && !imagePending) || connection !== 'live' || sending
              "
            >
              {{ sending ? 'Sending…' : 'Send' }}
            </button>
          </form>
        </template>

        <div v-else class="empty thread-placeholder">
          <p>Select a conversation to start chatting.</p>
          <button
            class="button primary empty-cta"
            type="button"
            @click="openFriendPicker"
          >
            Message a friend
          </button>
        </div>
      </section>
    </div>

    <div
      v-if="showFriendPicker"
      class="modal-backdrop"
      @click.self="closeFriendPicker"
    >
      <div class="modal">
        <div class="modal-head">
          <h2>New message</h2>
          <button
            class="friend-card-close"
            type="button"
            aria-label="Close friend picker"
            @click="closeFriendPicker"
          >
            ×
          </button>
        </div>

        <input
          ref="searchInput"
          v-model="friendSearch"
          class="friend-search"
          type="text"
          placeholder="Search friends…"
          autocomplete="off"
          @keydown.esc="closeFriendPicker"
        />

        <div class="picker-list">
          <div v-if="!pickerFriends.length" class="empty">
            {{
              friends.length
                ? 'No friends to message — everyone is already in a conversation.'
                : 'No friends yet — add friends from the Friends page first.'
            }}
          </div>

          <div
            v-for="item in pickerFriends"
            :key="item.id"
            class="list-row picker-row"
            role="button"
            tabindex="0"
            @click="startConversation(item.friend.id)"
            @keydown.enter="startConversation(item.friend.id)"
          >
            <div class="conversation-avatar">
              {{ item.friend.username.charAt(0).toUpperCase() }}
              <i
                class="presence-dot"
                :class="presence.isOnline(item.friend.id) ? 'online' : 'offline'"
              ></i>
            </div>
            <div>
              <strong>{{ item.friend.username }}</strong>
              <small>{{ item.friend.email }}</small>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="socketError" class="toast chat-toast">
      {{ socketError }}
    </div>
  </section>
</template>