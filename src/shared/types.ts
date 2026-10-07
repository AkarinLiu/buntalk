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
  /** reputation; new accounts start at CREDIT_START (100) */
  credit: number
  /** admin-facing; '' when not banned */
  banReason: string
  /** ISO timestamp for a temporary ban, null for a permanent one / not banned */
  bannedUntil: string | null
  createdAt: string
  /** bound email, lowercased; '' when none */
  email: string
  /** whether `email` has been confirmed with a mailed code */
  emailVerified: boolean
  /**
   * Bumped on password reset. The session cookie carries it, so a bump makes
   * every previously issued cookie stale — that is how a reset logs everyone out.
   */
  sessionVersion: number
}

/** Auth path only — never serialize this to the client. */
export interface UserAuthRow extends UserRow {
  passwordHash: string
}

export interface CategoryRow {
  id: number
  /** null for a top-level 版块; set to the parent id for a 子版块 (one level only) */
  parentId: number | null
  name: string
  description: string
  position: number
  /** filled by list queries only */
  threadCount?: number
  childCount?: number
}

export interface TagRow {
  id: number
  name: string
  /** filled by list queries only */
  threadCount?: number
}

/** Site-wide settings; the single row (id = 1) holds the site's name and blurb. */
export interface SettingsRow {
  siteName: string
  siteDescription: string
}

export interface ThreadRow {
  id: number
  categoryId: number
  authorId: number
  title: string
  /** pinned within its own category */
  isPinned: boolean
  /** site-wide announcement: home + every board; at most GLOBAL_PIN_LIMIT at once */
  isGlobalPinned: boolean
  /** shown at the top of every board page (but not the home feed) */
  isAllBoardsPinned: boolean
  isLocked: boolean
  createdAt: string
  lastPostAt: string
  /** incremented by the view beacon; a real column, always present */
  viewCount: number
  /** filled by list queries only */
  author?: Pick<UserRow, 'id' | 'username' | 'displayName' | 'avatarUrl'>
  postCount?: number
  tags?: TagRow[]
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

/** Safe-to-send user projection — no passwordHash, no ban internals. */
export type PublicUser = Pick<
  UserRow,
  'id' | 'username' | 'displayName' | 'bio' | 'avatarUrl' | 'role' | 'credit' | 'createdAt'
>

export const toPublicUser = (u: UserRow): PublicUser => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  bio: u.bio,
  avatarUrl: u.avatarUrl,
  role: u.role,
  credit: u.credit,
  createdAt: u.createdAt,
})

/**
 * The session's own user: adds the email, which must never leave the account —
 * `PublicUser` (and every `/users/:username` response) deliberately omits it.
 */
export type SelfUser = PublicUser & Pick<UserRow, 'email' | 'emailVerified'>

export const toSelfUser = (u: UserRow): SelfUser => ({
  ...toPublicUser(u),
  email: u.email,
  emailVerified: u.emailVerified,
})

/** `verify` confirms a bound email; `reset` authorizes a password change. */
export type EmailTokenKind = 'verify' | 'reset'

/** One active mailed code per (user, kind); re-issuing replaces the row. */
export interface EmailTokenRow {
  userId: number
  kind: EmailTokenKind
  codeHash: string
  expiresAt: string
  attempts: number
  createdAt: string
}

/** Admin-only user view: adds moderation fields that must never reach the public API. */
export interface AdminUser extends PublicUser {
  /** omitted from `PublicUser` on purpose; the admin table needs it */
  banned: boolean
  postCount: number
  banReason: string
  bannedUntil: string | null
}

export type ReportTarget = 'thread' | 'post'
export type ReportStatus = 'open' | 'accepted' | 'rejected'

/** A lightweight user projection carried on a report. */
export type ReportUser = Pick<UserRow, 'id' | 'username' | 'displayName' | 'avatarUrl' | 'credit'>

export interface ReportRow {
  id: number
  reporterId: number
  targetType: ReportTarget
  targetId: number
  reason: string
  status: ReportStatus
  createdAt: string
  handledBy: number | null
  handledAt: string | null
  /** filled by list queries only */
  reporter?: ReportUser
  targetAuthor?: ReportUser
  /** thread title, or a short preview of a reported post */
  targetLabel?: string
  /** the thread the target lives in, for linking */
  targetThreadId?: number | null
}
