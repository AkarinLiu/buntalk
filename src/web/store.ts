/**
 * Session state. One reactive object shared by every component — no Pinia.
 */
import { reactive } from 'vue'
import { http } from './api'
import type { SessionResponse } from './api'
import type { PublicUser } from '../shared/types'

export const auth = reactive<{
  user: PublicUser | null
  loaded: boolean
}>({
  user: null,
  loaded: false,
})

/** Re-reads the session cookie. Never throws — an anonymous visitor is not an error. */
export async function refreshSession(): Promise<void> {
  try {
    const { user } = await http.get<SessionResponse>('/auth/me')
    auth.user = user
  } catch {
    auth.user = null
  } finally {
    auth.loaded = true
  }
}

export async function logout(): Promise<void> {
  await http.post('/auth/logout')
  auth.user = null
}
