/**
 * Session state. One reactive object shared by every component — no Pinia.
 * The badge groups are cached here too: they are tiny, public, and read by the
 * post and profile views on almost every page.
 */
import { reactive } from 'vue'
import { http } from './api'
import type { SessionResponse } from './api'
import type { SelfUser, UserGroupRow } from '../shared/types'

export const auth = reactive<{
  user: SelfUser | null
  loaded: boolean
}>({
  user: null,
  loaded: false,
})

export const groups = reactive<{
  loaded: boolean
  list: UserGroupRow[]
}>({
  loaded: false,
  list: [],
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

/** Loaded once by the router guard, like the setup/meta probes. */
export async function loadGroups(): Promise<void> {
  try {
    groups.list = await http.get<UserGroupRow[]>('/groups')
  } catch {
    groups.list = []
  } finally {
    groups.loaded = true
  }
}

export const groupById = (id: number | null | undefined): UserGroupRow | null =>
  id == null ? null : (groups.list.find((g) => g.id === id) ?? null)
