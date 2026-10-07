// SQLite dialect schema. Keep in sync with `../types.ts` and `../ddl.ts`.
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  bio: text('bio').notNull(),
  avatarUrl: text('avatar_url').notNull(),
  role: text('role').notNull(),
  banned: integer('banned', { mode: 'boolean' }).notNull(),
  credit: integer('credit').notNull(),
  banReason: text('ban_reason').notNull(),
  bannedUntil: text('banned_until'),
  createdAt: text('created_at').notNull(),
  email: text('email').notNull(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull(),
  sessionVersion: integer('session_version').notNull(),
})

export const emailTokens = sqliteTable('email_tokens', {
  userId: integer('user_id').notNull(),
  kind: text('kind').notNull(),
  codeHash: text('code_hash').notNull(),
  expiresAt: text('expires_at').notNull(),
  attempts: integer('attempts').notNull(),
  createdAt: text('created_at').notNull(),
})

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  parentId: integer('parent_id'),
  name: text('name').notNull(),
  description: text('description').notNull(),
  position: integer('position').notNull(),
})

export const threads = sqliteTable('threads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  categoryId: integer('category_id').notNull(),
  authorId: integer('author_id').notNull(),
  title: text('title').notNull(),
  isPinned: integer('is_pinned', { mode: 'boolean' }).notNull(),
  isLocked: integer('is_locked', { mode: 'boolean' }).notNull(),
  isGlobalPinned: integer('is_global_pinned', { mode: 'boolean' }).notNull(),
  isAllBoardsPinned: integer('is_all_boards_pinned', { mode: 'boolean' }).notNull(),
  viewCount: integer('view_count').notNull(),
  createdAt: text('created_at').notNull(),
  lastPostAt: text('last_post_at').notNull(),
})

export const posts = sqliteTable('posts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  threadId: integer('thread_id').notNull(),
  authorId: integer('author_id').notNull(),
  parentId: integer('parent_id'),
  body: text('body').notNull(),
  createdAt: text('created_at').notNull(),
})

export const postLikes = sqliteTable('post_likes', {
  postId: integer('post_id').notNull(),
  userId: integer('user_id').notNull(),
})

export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
})

export const threadTags = sqliteTable('thread_tags', {
  threadId: integer('thread_id').notNull(),
  tagId: integer('tag_id').notNull(),
})

export const reports = sqliteTable('reports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  reporterId: integer('reporter_id').notNull(),
  targetType: text('target_type').notNull(),
  targetId: integer('target_id').notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  handledBy: integer('handled_by'),
  handledAt: text('handled_at'),
})

// Single row (id = 1); the DDL pins that with a CHECK constraint.
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  siteName: text('site_name').notNull(),
  siteDescription: text('site_description').notNull(),
})
