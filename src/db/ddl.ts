/**
 * Bootstrap DDL, one set per dialect.
 *
 * Deliberately not drizzle-kit: the framework self-creates its schema on first
 * boot, so there is no `db:push` step for a fresh clone (or an agent) to forget.
 * Every statement is idempotent (`IF NOT EXISTS`), so it re-runs on every start.
 *
 * ponytail: schema lives in two places — this file and `schema/*.ts`. They must
 * be edited together; `schema/*.ts` only ever affects generated SQL shape, so a
 * mismatch shows up as a runtime "no such column", not silently. Upgrade path:
 * generate these from the Drizzle schemas with drizzle-kit if drift bites.
 *
 * Index statements are separate because MySQL has no `CREATE INDEX IF NOT
 * EXISTS` and they are the only statements allowed to fail harmlessly.
 */
import type { Dialect } from '../shared/types'

const sqlite = {
  tables: [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user',
      banned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_locked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_post_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS post_likes (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (post_id, user_id)
    )`,
  ],
  indexes: [
    `CREATE INDEX IF NOT EXISTS idx_threads_category ON threads(category_id)`,
    `CREATE INDEX IF NOT EXISTS idx_threads_last_post ON threads(last_post_at)`,
    `CREATE INDEX IF NOT EXISTS idx_posts_thread ON posts(thread_id)`,
    `CREATE INDEX IF NOT EXISTS idx_post_likes_user ON post_likes(user_id)`,
  ],
}

const pg = {
  tables: [
    `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user',
      banned BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS threads (
      id SERIAL PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
      is_locked BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TEXT NOT NULL,
      last_post_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS post_likes (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (post_id, user_id)
    )`,
  ],
  indexes: [
    `CREATE INDEX IF NOT EXISTS idx_threads_category ON threads(category_id)`,
    `CREATE INDEX IF NOT EXISTS idx_threads_last_post ON threads(last_post_at)`,
    `CREATE INDEX IF NOT EXISTS idx_posts_thread ON posts(thread_id)`,
    `CREATE INDEX IF NOT EXISTS idx_post_likes_user ON post_likes(user_id)`,
  ],
}

// MySQL: TEXT can be neither UNIQUE/INDEXed without a key length nor given a
// DEFAULT, hence VARCHAR for short strings. All tables InnoDB + utf8mb4 so the
// FKs are enforced and CJK content round-trips.
const mysql = {
  tables: [
    `CREATE TABLE IF NOT EXISTS users (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(191) NOT NULL,
      display_name VARCHAR(191) NOT NULL,
      password_hash TEXT NOT NULL,
      bio TEXT NOT NULL,
      avatar_url VARCHAR(512) NOT NULL DEFAULT '',
      role VARCHAR(32) NOT NULL DEFAULT 'user',
      banned TINYINT(1) NOT NULL DEFAULT 0,
      created_at VARCHAR(40) NOT NULL,
      UNIQUE KEY uq_users_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS categories (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(191) NOT NULL,
      description TEXT NOT NULL,
      position INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS threads (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      category_id INT NOT NULL,
      author_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      is_pinned TINYINT(1) NOT NULL DEFAULT 0,
      is_locked TINYINT(1) NOT NULL DEFAULT 0,
      created_at VARCHAR(40) NOT NULL,
      last_post_at VARCHAR(40) NOT NULL,
      KEY idx_threads_category (category_id),
      KEY idx_threads_last_post (last_post_at),
      CONSTRAINT fk_threads_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
      CONSTRAINT fk_threads_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS posts (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      thread_id INT NOT NULL,
      author_id INT NOT NULL,
      parent_id INT NULL,
      body TEXT NOT NULL,
      created_at VARCHAR(40) NOT NULL,
      KEY idx_posts_thread (thread_id),
      CONSTRAINT fk_posts_thread FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
      CONSTRAINT fk_posts_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_posts_parent FOREIGN KEY (parent_id) REFERENCES posts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS post_likes (
      post_id INT NOT NULL,
      user_id INT NOT NULL,
      PRIMARY KEY (post_id, user_id),
      KEY idx_post_likes_user (user_id),
      CONSTRAINT fk_likes_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      CONSTRAINT fk_likes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  ],
  indexes: [] as string[],
}

export const DDL: Record<Dialect, { tables: string[]; indexes: string[] }> = {
  sqlite,
  pg,
  mysql,
}
