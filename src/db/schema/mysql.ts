// MySQL dialect schema. Keep in sync with `../types.ts` and `../ddl.ts`.
//
// Two MySQL-specific rules drive the column types here:
//   * a UNIQUE/INDEX key over TEXT needs an explicit key length, so any
//     indexed or unique short string is VARCHAR instead of TEXT;
//   * TEXT columns cannot carry a DEFAULT, so defaults live only on the
//     fixed-width types. The app always passes every value anyway.
import { boolean, int, mysqlTable, text, varchar } from 'drizzle-orm/mysql-core'

export const users = mysqlTable('users', {
  id: int('id').autoincrement().primaryKey(),
  username: varchar('username', { length: 191 }).notNull().unique(),
  displayName: varchar('display_name', { length: 191 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  bio: text('bio').notNull(),
  avatarUrl: varchar('avatar_url', { length: 512 }).notNull(),
  role: varchar('role', { length: 32 }).notNull(),
  banned: boolean('banned').notNull(),
  credit: int('credit').notNull(),
  banReason: varchar('ban_reason', { length: 255 }).notNull(),
  bannedUntil: varchar('banned_until', { length: 40 }),
  createdAt: varchar('created_at', { length: 40 }).notNull(),
  email: varchar('email', { length: 254 }).notNull(),
  emailVerified: boolean('email_verified').notNull(),
  sessionVersion: int('session_version').notNull(),
})

export const emailTokens = mysqlTable('email_tokens', {
  userId: int('user_id').notNull(),
  kind: varchar('kind', { length: 16 }).notNull(),
  codeHash: varchar('code_hash', { length: 128 }).notNull(),
  expiresAt: varchar('expires_at', { length: 40 }).notNull(),
  attempts: int('attempts').notNull(),
  createdAt: varchar('created_at', { length: 40 }).notNull(),
})

export const categories = mysqlTable('categories', {
  id: int('id').autoincrement().primaryKey(),
  parentId: int('parent_id'),
  name: varchar('name', { length: 191 }).notNull(),
  description: text('description').notNull(),
  position: int('position').notNull(),
})

export const threads = mysqlTable('threads', {
  id: int('id').autoincrement().primaryKey(),
  categoryId: int('category_id').notNull(),
  authorId: int('author_id').notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  isPinned: boolean('is_pinned').notNull(),
  isLocked: boolean('is_locked').notNull(),
  isGlobalPinned: boolean('is_global_pinned').notNull(),
  isAllBoardsPinned: boolean('is_all_boards_pinned').notNull(),
  viewCount: int('view_count').notNull(),
  createdAt: varchar('created_at', { length: 40 }).notNull(),
  lastPostAt: varchar('last_post_at', { length: 40 }).notNull(),
})

export const posts = mysqlTable('posts', {
  id: int('id').autoincrement().primaryKey(),
  threadId: int('thread_id').notNull(),
  authorId: int('author_id').notNull(),
  parentId: int('parent_id'),
  body: text('body').notNull(),
  createdAt: varchar('created_at', { length: 40 }).notNull(),
})

export const postLikes = mysqlTable('post_likes', {
  postId: int('post_id').notNull(),
  userId: int('user_id').notNull(),
})

export const tags = mysqlTable('tags', {
  id: int('id').autoincrement().primaryKey(),
  name: varchar('name', { length: 191 }).notNull().unique(),
})

export const threadTags = mysqlTable('thread_tags', {
  threadId: int('thread_id').notNull(),
  tagId: int('tag_id').notNull(),
})

export const reports = mysqlTable('reports', {
  id: int('id').autoincrement().primaryKey(),
  reporterId: int('reporter_id').notNull(),
  targetType: varchar('target_type', { length: 16 }).notNull(),
  targetId: int('target_id').notNull(),
  reason: text('reason').notNull(),
  status: varchar('status', { length: 16 }).notNull(),
  createdAt: varchar('created_at', { length: 40 }).notNull(),
  handledBy: int('handled_by'),
  handledAt: varchar('handled_at', { length: 40 }),
})

// Single row (id = 1); the DDL pins that with a CHECK constraint.
export const settings = mysqlTable('settings', {
  id: int('id').primaryKey(),
  siteName: varchar('site_name', { length: 191 }).notNull(),
  siteDescription: varchar('site_description', { length: 500 }).notNull(),
})
