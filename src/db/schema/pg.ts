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
  banned: boolean('banned').notNull(),
  createdAt: text('created_at').notNull(),
})

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
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
