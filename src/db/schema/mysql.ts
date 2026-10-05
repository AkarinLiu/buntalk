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
  createdAt: varchar('created_at', { length: 40 }).notNull(),
})

export const categories = mysqlTable('categories', {
  id: int('id').autoincrement().primaryKey(),
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
