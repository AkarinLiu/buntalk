/**
 * One entry point for whatever `DATABASE_URL` points at.
 *
 * ponytail: `db` and `tables` are `any` on purpose. Drizzle's query builder is
 * structurally identical across dialects but its *types* are not correlated —
 * a `PgDatabase` only accepts `pgTable`s — so supporting three engines from one
 * codebase means either branching on the dialect in every query or dropping the
 * handle's type. We drop it here, once, and recover the safety from the domain
 * row types in `types.ts` instead. Upgrade path: a repository per dialect if
 * compile-time query checking starts paying for itself.
 *
 * Drivers are imported lazily, so an SQLite install never loads `pg`/`mysql2`.
 */
import { DDL } from './ddl'
import type { Dialect } from '../shared/types'

export type { Dialect }
export type {
  UserRow,
  UserAuthRow,
  CategoryRow,
  TagRow,
  SettingsRow,
  ThreadRow,
  PostRow,
  PublicUser,
  SelfUser,
  AdminUser,
  ReportRow,
  ReportStatus,
  ReportTarget,
  Role,
  EmailTokenKind,
  EmailTokenRow,
} from '../shared/types'

function detect(url: string): Dialect {
  if (/^(mysql|mysql2):\/\//i.test(url)) return 'mysql'
  if (/^(postgres|postgresql)(\+srv)?:\/\//i.test(url)) return 'pg'
  return 'sqlite'
}

/** `sqlite:./x.db`, `file:./x.db`, `./x.db` and `:memory:` all reach a path. */
function sqlitePath(url: string): string {
  const stripped = url.replace(/^sqlite(\+file)?:\/\//i, '').replace(/^file:\/\//i, '')
  return stripped === '' ? './buntalk.db' : stripped
}

const url = process.env.DATABASE_URL?.trim() || './buntalk.db'
const kind = detect(url)

let db: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see file header
let tables: any
let exec: (stmt: string) => unknown

if (kind === 'sqlite') {
  const { Database } = await import('bun:sqlite')
  const { drizzle } = await import('drizzle-orm/bun-sqlite')
  const conn = new Database(sqlitePath(url))
  // WAL so readers never block the writer; FK enforcement is OFF by default
  // in SQLite and the cascade deletes in our DDL depend on it being on.
  conn.exec('PRAGMA journal_mode = WAL')
  conn.exec('PRAGMA foreign_keys = ON')
  db = drizzle(conn)
  tables = await import('./schema/sqlite')
  exec = (stmt) => conn.exec(stmt)
} else if (kind === 'pg') {
  const { Pool } = await import('pg')
  const { drizzle } = await import('drizzle-orm/node-postgres')
  const pool = new Pool({ connectionString: url, max: 10 })
  db = drizzle(pool)
  tables = await import('./schema/pg')
  exec = (stmt) => pool.query(stmt)
} else {
  const { createPool } = await import('mysql2/promise')
  const { drizzle } = await import('drizzle-orm/mysql2')
  const pool = createPool({ uri: url, waitForConnections: true, connectionLimit: 10 })
  db = drizzle(pool)
  tables = await import('./schema/mysql')
  exec = (stmt) => pool.query(stmt)
}

export const dialect: Dialect = kind
export const databaseUrl = url
export { db, tables }

/**
 * Idempotent schema bootstrap, run on every boot. Tables are strict — if the
 * DDL cannot be applied we must not serve traffic against a half-built schema.
 * Indexes are tolerant because MySQL has no `CREATE INDEX IF NOT EXISTS`.
 */
export async function ensureSchema(): Promise<void> {
  const set = DDL[kind]
  for (const stmt of set.tables) {
    try {
      exec(stmt)
    } catch (err) {
      console.error(`\n[buntalk] schema statement failed (${kind}):\n${stmt.trim()}\n`)
      throw err
    }
  }
  for (const stmt of set.patches) {
    try {
      exec(stmt)
    } catch {
      // column already added on a fresh bootstrap — nothing to do
    }
  }
  for (const stmt of set.indexes) {
    try {
      exec(stmt)
    } catch {
      // duplicate index / unsupported IF NOT EXISTS — already applied
    }
  }
}
