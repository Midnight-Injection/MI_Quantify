import { invoke } from '@tauri-apps/api/core'

export interface ChatConversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface ChatMessageRecord {
  id?: number
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  code?: string
  stockName?: string
  mode?: string
  meta?: string
  createdAt: number
}

export async function listConversations(): Promise<ChatConversation[]> {
  return invoke<ChatConversation[]>('chat_conversation_list')
}

export async function createConversation(id: string, title: string): Promise<ChatConversation> {
  return invoke<ChatConversation>('chat_conversation_create', { id, title })
}

export async function updateConversationTitle(id: string, title: string): Promise<void> {
  await invoke('chat_conversation_update_title', { id, title })
}

export async function deleteConversation(id: string): Promise<void> {
  await invoke('chat_conversation_delete', { id })
}

export async function listMessages(conversationId: string, limit = 200): Promise<ChatMessageRecord[]> {
  return invoke<ChatMessageRecord[]>('chat_message_list', { conversationId, limit })
}

export async function addMessage(message: ChatMessageRecord): Promise<void> {
  await invoke('chat_message_add', { message })
}

export async function clearMessages(conversationId: string): Promise<void> {
  await invoke('chat_message_clear', { conversationId })
}
