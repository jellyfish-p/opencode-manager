import Database from 'better-sqlite3'
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
  referral_code: string | null
  subscription_status: string | null
  status: AccountStatus
  last_error: string | null
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

export type AccountPublic = Omit<Account, 'auth_cookie'>

let db: Database.Database | null = null

export function getDb() {
  if (db) return db

  const dataDir = resolve(process.cwd(), 'data')
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })

  db = new Database(resolve(dataDir, 'opencode.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

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
      referral_code TEXT,
      subscription_status TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
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
  `)

  return db
}

export function toPublicAccount(row: Account): AccountPublic {
  const { auth_cookie: _, ...rest } = row
  return rest
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
  const values: Record<string, unknown> = { id }

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
