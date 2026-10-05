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
  createdAt: text('created_at').notNull(),
})

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
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
