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
 * EXISTS` and they are the only statements allowed to fail harmlessly. `patches`
 * are the same idea for columns added after a table first shipped (SQLite/PG/
 * MySQL all lack `ADD COLUMN IF NOT EXISTS`), so an older database upgrades
 * itself on boot instead of needing a migration step.
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
      credit INTEGER NOT NULL DEFAULT 100,
      ban_reason TEXT NOT NULL DEFAULT '',
      banned_until TEXT,
      email TEXT NOT NULL DEFAULT '',
      email_verified INTEGER NOT NULL DEFAULT 0,
      session_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS email_tokens (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, kind)
    )`,
    `CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
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
      is_global_pinned INTEGER NOT NULL DEFAULT 0,
      is_all_boards_pinned INTEGER NOT NULL DEFAULT 0,
      view_count INTEGER NOT NULL DEFAULT 0,
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
    `CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    )`,
    `CREATE TABLE IF NOT EXISTS thread_tags (
      thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (thread_id, tag_id)
    )`,
    `CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      handled_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      site_name TEXT NOT NULL DEFAULT '',
      site_description TEXT NOT NULL DEFAULT ''
    )`,
  ],
  patches: [
    // Added after the fact; tolerant so a fresh bootstrap (which already has the
    // column in the CREATE above) does not abort startup.
    `ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE`,
    `ALTER TABLE users ADD COLUMN credit INTEGER NOT NULL DEFAULT 100`,
    `ALTER TABLE users ADD COLUMN ban_reason TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN banned_until TEXT`,
    `ALTER TABLE threads ADD COLUMN is_global_pinned BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE threads ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE threads ADD COLUMN is_all_boards_pinned BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0`,
  ],
  indexes: [
    `CREATE INDEX IF NOT EXISTS idx_threads_category ON threads(category_id)`,
    `CREATE INDEX IF NOT EXISTS idx_threads_last_post ON threads(last_post_at)`,
    `CREATE INDEX IF NOT EXISTS idx_posts_thread ON posts(thread_id)`,
    `CREATE INDEX IF NOT EXISTS idx_post_likes_user ON post_likes(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_thread_tags_tag ON thread_tags(tag_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status)`,
    `CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id)`,
    `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
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
      credit INTEGER NOT NULL DEFAULT 100,
      ban_reason TEXT NOT NULL DEFAULT '',
      banned_until TEXT,
      email TEXT NOT NULL DEFAULT '',
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      session_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS email_tokens (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, kind)
    )`,
    `CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
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
      is_global_pinned BOOLEAN NOT NULL DEFAULT FALSE,
      is_all_boards_pinned BOOLEAN NOT NULL DEFAULT FALSE,
      view_count INTEGER NOT NULL DEFAULT 0,
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
    `CREATE TABLE IF NOT EXISTS tags (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    )`,
    `CREATE TABLE IF NOT EXISTS thread_tags (
      thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (thread_id, tag_id)
    )`,
    `CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      handled_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      site_name TEXT NOT NULL DEFAULT '',
      site_description TEXT NOT NULL DEFAULT ''
    )`,
  ],
  patches: [
    // Added after the fact; tolerant so a fresh bootstrap (which already has the
    // column in the CREATE above) does not abort startup.
    `ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE`,
    `ALTER TABLE users ADD COLUMN credit INTEGER NOT NULL DEFAULT 100`,
    `ALTER TABLE users ADD COLUMN ban_reason TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN banned_until TEXT`,
    `ALTER TABLE threads ADD COLUMN is_global_pinned BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE threads ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE threads ADD COLUMN is_all_boards_pinned BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0`,
  ],
  indexes: [
    `CREATE INDEX IF NOT EXISTS idx_threads_category ON threads(category_id)`,
    `CREATE INDEX IF NOT EXISTS idx_threads_last_post ON threads(last_post_at)`,
    `CREATE INDEX IF NOT EXISTS idx_posts_thread ON posts(thread_id)`,
    `CREATE INDEX IF NOT EXISTS idx_post_likes_user ON post_likes(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_thread_tags_tag ON thread_tags(tag_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status)`,
    `CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id)`,
    `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
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
      credit INT NOT NULL DEFAULT 100,
      ban_reason VARCHAR(255) NOT NULL DEFAULT '',
      banned_until VARCHAR(40) NULL,
      email VARCHAR(254) NOT NULL DEFAULT '',
      email_verified TINYINT(1) NOT NULL DEFAULT 0,
      session_version INT NOT NULL DEFAULT 0,
      created_at VARCHAR(40) NOT NULL,
      UNIQUE KEY uq_users_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS email_tokens (
      user_id INT NOT NULL,
      kind VARCHAR(16) NOT NULL,
      code_hash VARCHAR(128) NOT NULL,
      expires_at VARCHAR(40) NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      created_at VARCHAR(40) NOT NULL,
      PRIMARY KEY (user_id, kind),
      CONSTRAINT fk_email_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS categories (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      parent_id INT NULL,
      name VARCHAR(191) NOT NULL,
      description TEXT NOT NULL,
      position INT NOT NULL DEFAULT 0,
      KEY idx_categories_parent (parent_id),
      CONSTRAINT fk_categories_parent FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS threads (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      category_id INT NOT NULL,
      author_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      is_pinned TINYINT(1) NOT NULL DEFAULT 0,
      is_locked TINYINT(1) NOT NULL DEFAULT 0,
      is_global_pinned TINYINT(1) NOT NULL DEFAULT 0,
      is_all_boards_pinned TINYINT(1) NOT NULL DEFAULT 0,
      view_count INT NOT NULL DEFAULT 0,
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
    `CREATE TABLE IF NOT EXISTS tags (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(191) NOT NULL,
      UNIQUE KEY uq_tags_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS thread_tags (
      thread_id INT NOT NULL,
      tag_id INT NOT NULL,
      PRIMARY KEY (thread_id, tag_id),
      KEY idx_thread_tags_tag (tag_id),
      CONSTRAINT fk_thread_tags_thread FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
      CONSTRAINT fk_thread_tags_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS reports (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      reporter_id INT NOT NULL,
      target_type VARCHAR(16) NOT NULL,
      target_id INT NOT NULL,
      reason TEXT NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'open',
      created_at VARCHAR(40) NOT NULL,
      handled_by INT NULL,
      handled_at VARCHAR(40) NULL,
      KEY idx_reports_status (status),
      KEY idx_reports_target (target_type, target_id),
      CONSTRAINT fk_reports_reporter FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_reports_handler FOREIGN KEY (handled_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS settings (
      id INT NOT NULL PRIMARY KEY,
      site_name VARCHAR(191) NOT NULL DEFAULT '',
      site_description VARCHAR(500) NOT NULL DEFAULT '',
      CONSTRAINT chk_settings_single CHECK (id = 1)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  ],
  patches: [
    // Tolerant: harmless on a fresh bootstrap (column/FK already in the CREATE).
    `ALTER TABLE categories ADD COLUMN parent_id INT NULL`,
    `ALTER TABLE categories ADD CONSTRAINT fk_categories_parent FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE`,
    `ALTER TABLE users ADD COLUMN credit INT NOT NULL DEFAULT 100`,
    `ALTER TABLE users ADD COLUMN ban_reason VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN banned_until VARCHAR(40) NULL`,
    `ALTER TABLE threads ADD COLUMN is_global_pinned TINYINT(1) NOT NULL DEFAULT 0`,
    `ALTER TABLE threads ADD COLUMN view_count INT NOT NULL DEFAULT 0`,
    `ALTER TABLE threads ADD COLUMN is_all_boards_pinned TINYINT(1) NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN email VARCHAR(254) NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN session_version INT NOT NULL DEFAULT 0`,
  ],
  // Tolerant: MySQL has no CREATE INDEX IF NOT EXISTS, so a re-run just fails.
  indexes: [`CREATE INDEX idx_users_email ON users(email)`] as string[],
}

export const DDL: Record<Dialect, { tables: string[]; patches: string[]; indexes: string[] }> = {
  sqlite,
  pg,
  mysql,
}
