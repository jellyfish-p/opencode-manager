import { Database } from 'bun:sqlite'
import { resolve } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'

export type AccountStatus = 'pending' | 'active' | 'error' | 'disabled'

export interface Account {
  id: number
  name: string | null
  auth_cookie: string
  email: string | null
  workspace_id: string | null
  workspace_name: string | null
  balance: number | null
  rolling_usage: number | null
  rolling_reset_sec: number | null
  weekly_usage: number | null
  weekly_reset_sec: number | null
  monthly_usage: number | null
  monthly_reset_sec: number | null
  rolling_reset_at: string | null
  weekly_reset_at: string | null
  monthly_reset_at: string | null
  next_quota_refresh_at: string | null
  quota_refreshed_at: string | null
  referral_code: string | null
  subscription_status: string | null
  upstream_api_key: string | null
  status: AccountStatus
  disabled_reason: string | null
  auto_enable_at: string | null
  last_error: string | null
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

export type AccountPublic = Omit<Account, 'auth_cookie' | 'upstream_api_key'> & {
  has_upstream_api_key: boolean
}

export interface ManagedApiKey {
  id: number
  name: string
  key_hash: string
  key_prefix: string
  created_at: string
}

type SQLiteValue = string | number | bigint | boolean | Uint8Array | null

let db: Database | null = null

export function getDb() {
  if (db) return db

  const dataDir = resolve(process.cwd(), process.env.DATA_DIR || 'data')
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })

  db = new Database(resolve(dataDir, 'opencode.db'), { strict: true })
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      auth_cookie TEXT NOT NULL,
      email TEXT,
      workspace_id TEXT,
      workspace_name TEXT,
      balance REAL,
      rolling_usage REAL,
      rolling_reset_sec INTEGER,
      weekly_usage REAL,
      weekly_reset_sec INTEGER,
      monthly_usage REAL,
      monthly_reset_sec INTEGER,
      rolling_reset_at TEXT,
      weekly_reset_at TEXT,
      monthly_reset_at TEXT,
      next_quota_refresh_at TEXT,
      quota_refreshed_at TEXT,
      referral_code TEXT,
      subscription_status TEXT,
      upstream_api_key TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      disabled_reason TEXT,
      auto_enable_at TEXT,
      last_error TEXT,
      last_synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  migrateAccountColumns(db)

  return db
}

export function toPublicAccount(row: Account): AccountPublic {
  const { auth_cookie: _, upstream_api_key, ...rest } = row
  return { ...rest, has_upstream_api_key: Boolean(upstream_api_key) }
}

function migrateAccountColumns(database: Database) {
  const existing = new Set(
    (database.prepare('PRAGMA table_info(accounts)').all() as Array<{ name: string }>).map(c => c.name)
  )
  const columns: Record<string, string> = {
    rolling_reset_at: 'TEXT',
    weekly_reset_at: 'TEXT',
    monthly_reset_at: 'TEXT',
    next_quota_refresh_at: 'TEXT',
    quota_refreshed_at: 'TEXT',
    upstream_api_key: 'TEXT',
    disabled_reason: 'TEXT',
    auto_enable_at: 'TEXT'
  }
  for (const [name, type] of Object.entries(columns)) {
    if (!existing.has(name)) database.exec(`ALTER TABLE accounts ADD COLUMN ${name} ${type}`)
  }
}

export function listAccounts(): Account[] {
  return getDb().prepare('SELECT * FROM accounts ORDER BY id DESC').all() as Account[]
}

export function getAccount(id: number): Account | undefined {
  return getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Account | undefined
}

export function createAccount(input: { name?: string; auth_cookie: string }): Account {
  const result = getDb()
    .prepare(`
      INSERT INTO accounts (name, auth_cookie, status)
      VALUES (@name, @auth_cookie, 'pending')
    `)
    .run({
      name: input.name || null,
      auth_cookie: input.auth_cookie.trim()
    })

  return getAccount(Number(result.lastInsertRowid))!
}

export function updateAccount(id: number, data: Partial<Account>) {
  const fields: string[] = []
  const values: Record<string, SQLiteValue> = { id }

  for (const [key, value] of Object.entries(data)) {
    if (key === 'id' || key === 'created_at') continue
    fields.push(`${key} = @${key}`)
    values[key] = value
  }

  if (!fields.length) return getAccount(id)

  fields.push(`updated_at = datetime('now')`)
  getDb().prepare(`UPDATE accounts SET ${fields.join(', ')} WHERE id = @id`).run(values)
  return getAccount(id)
}

export function deleteAccount(id: number) {
  return getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id)
}

export function deleteNonMemberAccounts() {
  return getDb()
    .prepare(`DELETE FROM accounts WHERE subscription_status IS NULL OR subscription_status <> 'active'`)
    .run()
}

export function getProxyCandidates(): Account[] {
  return getDb()
    .prepare(`
      SELECT * FROM accounts
      WHERE status = 'active'
        AND subscription_status = 'active'
        AND upstream_api_key IS NOT NULL
        AND upstream_api_key <> ''
      ORDER BY id ASC
    `)
    .all() as Account[]
}

export function reserveProxyCandidates(): Account[] {
  const database = getDb()
  return database.transaction(() => {
    const accounts = getProxyCandidates()
    if (!accounts.length) return []
    const row = database.prepare(`SELECT value FROM app_settings WHERE key = 'pool_cursor'`).get() as
      | { value: string }
      | undefined
    const cursor = Number(row?.value || 0) % accounts.length
    database
      .prepare(`
        INSERT INTO app_settings (key, value) VALUES ('pool_cursor', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `)
      .run(String((cursor + 1) % accounts.length))
    return [...accounts.slice(cursor), ...accounts.slice(0, cursor)]
  })()
}

export function listManagedApiKeys(): ManagedApiKey[] {
  return getDb().prepare('SELECT * FROM api_keys ORDER BY id DESC').all() as ManagedApiKey[]
}

export function createManagedApiKey(input: {
  name: string
  key_hash: string
  key_prefix: string
}): ManagedApiKey {
  const result = getDb()
    .prepare('INSERT INTO api_keys (name, key_hash, key_prefix) VALUES (?, ?, ?)')
    .run(input.name, input.key_hash, input.key_prefix)
  return getDb().prepare('SELECT * FROM api_keys WHERE id = ?').get(result.lastInsertRowid) as ManagedApiKey
}

export function deleteManagedApiKey(id: number) {
  return getDb().prepare('DELETE FROM api_keys WHERE id = ?').run(id)
}

export function createSession(token: string, hours = 24 * 7) {
  getDb()
    .prepare(`
      INSERT INTO sessions (token, expires_at)
      VALUES (?, datetime('now', ?))
    `)
    .run(token, `+${hours} hours`)
}

export function findSession(token: string) {
  return getDb()
    .prepare(`
      SELECT * FROM sessions
      WHERE token = ? AND expires_at > datetime('now')
    `)
    .get(token) as { token: string; created_at: string; expires_at: string } | undefined
}

export function deleteSession(token: string) {
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export function cleanExpiredSessions() {
  getDb().prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run()
}
