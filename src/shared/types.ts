/**
 * Domain row shapes — the contract between the database layer and everything
 * that reads its rows (API responses, Vue components).
 *
 * This module is deliberately dependency-free: both `src/db` and `src/web`
 * import from it, so importing a *value* here can never drag Drizzle, `pg` or
 * `bun:sqlite` into the browser bundle. Always `import type` from this file
 * on the client.
 *
 * Drizzle has no cross-dialect table builder (`sqliteTable` / `pgTable` /
 * `mysqlTable` are mutually incompatible), so `db/schema/` holds one file per
 * dialect and this file holds the contract all three must satisfy.
 *
 * All timestamps are ISO-8601 UTC strings, not DB timestamps: identical
 * behaviour on all three engines, and they sort correctly as text.
 */

export type Dialect = 'sqlite' | 'pg' | 'mysql'
export type Role = 'user' | 'admin'

export interface UserRow {
  id: number
  username: string
  displayName: string
  bio: string
  avatarUrl: string
  role: Role
  banned: boolean
  createdAt: string
}

/** Auth path only — never serialize this to the client. */
export interface UserAuthRow extends UserRow {
  passwordHash: string
}

export interface CategoryRow {
  id: number
  name: string
  description: string
  position: number
  /** filled by list queries only */
  threadCount?: number
}

export interface ThreadRow {
  id: number
  categoryId: number
  authorId: number
  title: string
  isPinned: boolean
  isLocked: boolean
  createdAt: string
  lastPostAt: string
  /** filled by list queries only */
  author?: Pick<UserRow, 'id' | 'username' | 'displayName' | 'avatarUrl'>
  postCount?: number
}

export interface PostRow {
  id: number
  threadId: number
  authorId: number
  /** null only on a thread's opening post; every reply targets a post */
  parentId: number | null
  body: string
  createdAt: string
  /** filled by list queries only */
  author?: Pick<UserRow, 'id' | 'username' | 'displayName' | 'avatarUrl' | 'role'>
  likeCount?: number
  likedByMe?: boolean
}

/** Safe-to-send user projection — no passwordHash, no internal flags. */
export type PublicUser = Pick<
  UserRow,
  'id' | 'username' | 'displayName' | 'bio' | 'avatarUrl' | 'role' | 'createdAt'
>

export const toPublicUser = (u: UserRow): PublicUser => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  bio: u.bio,
  avatarUrl: u.avatarUrl,
  role: u.role,
  createdAt: u.createdAt,
})
