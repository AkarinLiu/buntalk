// PostgreSQL dialect schema. Keep in sync with `../types.ts` and `../ddl.ts`.
import { boolean, integer, pgTable, serial, text } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  bio: text('bio').notNull(),
  avatarUrl: text('avatar_url').notNull(),
  role: text('role').notNull(),
  groupId: integer('group_id'),
  banned: boolean('banned').notNull(),
  credit: integer('credit').notNull(),
  banReason: text('ban_reason').notNull(),
  bannedUntil: text('banned_until'),
  createdAt: text('created_at').notNull(),
  email: text('email').notNull(),
  emailVerified: boolean('email_verified').notNull(),
  sessionVersion: integer('session_version').notNull(),
})

export const emailTokens = pgTable('email_tokens', {
  userId: integer('user_id').notNull(),
  kind: text('kind').notNull(),
  codeHash: text('code_hash').notNull(),
  expiresAt: text('expires_at').notNull(),
  attempts: integer('attempts').notNull(),
  createdAt: text('created_at').notNull(),
})

export const userGroups = pgTable('user_groups', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  color: text('color').notNull(),
  position: integer('position').notNull(),
})

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  parentId: integer('parent_id'),
  name: text('name').notNull(),
  description: text('description').notNull(),
  position: integer('position').notNull(),
})

export const threads = pgTable('threads', {
  id: serial('id').primaryKey(),
  categoryId: integer('category_id').notNull(),
  authorId: integer('author_id').notNull(),
  title: text('title').notNull(),
  isPinned: boolean('is_pinned').notNull(),
  isLocked: boolean('is_locked').notNull(),
  isGlobalPinned: boolean('is_global_pinned').notNull(),
  isAllBoardsPinned: boolean('is_all_boards_pinned').notNull(),
  viewCount: integer('view_count').notNull(),
  createdAt: text('created_at').notNull(),
  lastPostAt: text('last_post_at').notNull(),
})

export const posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  threadId: integer('thread_id').notNull(),
  authorId: integer('author_id').notNull(),
  parentId: integer('parent_id'),
  body: text('body').notNull(),
  createdAt: text('created_at').notNull(),
})

export const postLikes = pgTable('post_likes', {
  postId: integer('post_id').notNull(),
  userId: integer('user_id').notNull(),
})

export const tags = pgTable('tags', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
})

export const threadTags = pgTable('thread_tags', {
  threadId: integer('thread_id').notNull(),
  tagId: integer('tag_id').notNull(),
})

export const reports = pgTable('reports', {
  id: serial('id').primaryKey(),
  reporterId: integer('reporter_id').notNull(),
  targetType: text('target_type').notNull(),
  targetId: integer('target_id').notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  handledBy: integer('handled_by'),
  handledAt: text('handled_at'),
})

// Private conversations, their members and their messages.
export const dmThreads = pgTable('dm_threads', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  creatorId: integer('creator_id').notNull(),
  createdAt: text('created_at').notNull(),
  lastMessageAt: text('last_message_at').notNull(),
})

export const dmParticipants = pgTable('dm_participants', {
  threadId: integer('thread_id').notNull(),
  userId: integer('user_id').notNull(),
  lastReadAt: text('last_read_at'),
})

export const dmMessages = pgTable('dm_messages', {
  id: serial('id').primaryKey(),
  threadId: integer('thread_id').notNull(),
  authorId: integer('author_id').notNull(),
  body: text('body').notNull(),
  createdAt: text('created_at').notNull(),
})

// Single row (id = 1); the DDL pins that with a CHECK constraint.
export const settings = pgTable('settings', {
  id: integer('id').primaryKey(),
  siteName: text('site_name').notNull(),
  siteDescription: text('site_description').notNull(),
  siteNotice: text('site_notice').notNull(),
  siteFooter: text('site_footer').notNull(),
})

export const reportReasons = pgTable('report_reasons', {
  id: serial('id').primaryKey(),
  label: text('label').notNull().unique(),
  position: integer('position').notNull(),
})

export const drafts = pgTable('drafts', {
  id: serial('id').primaryKey(),
  authorId: integer('author_id').notNull(),
  categoryId: integer('category_id'),
  title: text('title').notNull(),
  body: text('body').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
