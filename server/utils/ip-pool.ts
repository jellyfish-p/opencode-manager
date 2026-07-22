import type { Account, IpPoolEntry } from './db'
import { getAccount, getDb, listAccounts, updateAccount } from './db'

const BLOCK_SIZE_SETTING = 'ip_pool_block_size'
const DEFAULT_BLOCK_SIZE = 5

export interface IpPoolPublicEntry {
  id: number
  name: string | null
  proxy_url: string
  enabled: boolean
  account_count: number
  last_ip: string | null
  last_check_ok: boolean | null
  last_checked_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface IpAssignmentChange {
  accountId: number
  ipPoolId: number | null
}

export function normalizeProxyUrl(input: unknown) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Proxy URL is required')
  let value = input.trim()
  if (/^sk5:\/\//i.test(value)) value = value.replace(/^sk5:/i, 'socks5:')

  // Accept the common ip:port:user:password export format in addition to URLs.
  if (!value.includes('://') && !value.includes('@')) {
    const parts = value.split(':')
    if (parts.length === 4 && /^\d+$/.test(parts[1]!)) {
      const [host, port, username, password] = parts
      value = `http://${encodeURIComponent(username!)}:${encodeURIComponent(password!)}@${host}:${port}`
    }
  }
  if (!value.includes('://')) value = `http://${value}`

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Invalid proxy URL')
  }
  if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(url.protocol)) {
    throw new Error('Only HTTP, HTTPS and SOCKS5 proxies are supported')
  }
  if (!url.hostname || !url.port) throw new Error('Proxy host and port are required')
  url.pathname = ''
  url.search = ''
  url.hash = ''
  return url.toString()
}

export function redactProxyUrl(proxyUrl: string) {
  const url = new URL(proxyUrl)
  if (url.password) url.password = '***'
  return url.toString()
}

function redactProxyError(message: string, proxyUrl: string) {
  const url = new URL(proxyUrl)
  let safe = message.replaceAll(proxyUrl, redactProxyUrl(proxyUrl))
  if (url.password) {
    safe = safe.replaceAll(url.password, '***')
  }
  return safe
}

export function getIpPoolBlockSize() {
  const row = getDb()
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(BLOCK_SIZE_SETTING) as { value: string } | undefined
  const parsed = Number(row?.value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 1000
    ? parsed
    : DEFAULT_BLOCK_SIZE
}

export function setIpPoolBlockSize(value: unknown) {
  const blockSize = Number(value)
  if (!Number.isInteger(blockSize) || blockSize < 1 || blockSize > 1000) {
    throw new Error('Block size must be an integer between 1 and 1000')
  }
  getDb().prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(BLOCK_SIZE_SETTING, String(blockSize))
  return blockSize
}

export function listIpPoolEntries(): IpPoolEntry[] {
  return getDb().prepare('SELECT * FROM ip_pool ORDER BY id ASC').all() as IpPoolEntry[]
}

export function getIpPoolEntry(id: number): IpPoolEntry | undefined {
  return getDb().prepare('SELECT * FROM ip_pool WHERE id = ?').get(id) as IpPoolEntry | undefined
}

export function listPublicIpPoolEntries(): IpPoolPublicEntry[] {
  const rows = getDb().prepare(`
    SELECT ip_pool.*, COUNT(accounts.id) AS account_count
    FROM ip_pool
    LEFT JOIN accounts ON accounts.ip_pool_id = ip_pool.id
    GROUP BY ip_pool.id
    ORDER BY ip_pool.id ASC
  `).all() as Array<IpPoolEntry & { account_count: number }>
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    proxy_url: redactProxyUrl(row.proxy_url),
    enabled: Boolean(row.enabled),
    account_count: row.account_count,
    last_ip: row.last_ip,
    last_check_ok: row.last_check_ok === null ? null : Boolean(row.last_check_ok),
    last_checked_at: row.last_checked_at,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at
  }))
}

export function createIpPoolEntry(input: { name?: string; proxy_url: unknown }) {
  const result = getDb().prepare(`
    INSERT INTO ip_pool (name, proxy_url) VALUES (?, ?)
  `).run(input.name?.trim() || null, normalizeProxyUrl(input.proxy_url))
  return getIpPoolEntry(Number(result.lastInsertRowid))!
}

export function updateIpPoolEntry(
  id: number,
  input: { name?: string | null; proxy_url?: unknown; enabled?: boolean }
) {
  const current = getIpPoolEntry(id)
  if (!current) return undefined
  const nextUrl = input.proxy_url === undefined
    ? current.proxy_url
    : normalizeProxyUrl(input.proxy_url)
  getDb().prepare(`
    UPDATE ip_pool
    SET name = ?, proxy_url = ?, enabled = ?,
        last_ip = CASE WHEN proxy_url = ? THEN last_ip ELSE NULL END,
        last_check_ok = CASE WHEN proxy_url = ? THEN last_check_ok ELSE NULL END,
        last_checked_at = CASE WHEN proxy_url = ? THEN last_checked_at ELSE NULL END,
        last_error = CASE WHEN proxy_url = ? THEN last_error ELSE NULL END,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    input.name === undefined ? current.name : input.name?.trim() || null,
    nextUrl,
    input.enabled === undefined ? current.enabled : input.enabled ? 1 : 0,
    nextUrl,
    nextUrl,
    nextUrl,
    nextUrl,
    id
  )
  return getIpPoolEntry(id)
}

export function deleteIpPoolEntry(id: number) {
  const accountIds = getDb()
    .prepare('SELECT id FROM accounts WHERE ip_pool_id = ?')
    .all(id) as Array<{ id: number }>
  for (const account of accountIds) updateAccount(account.id, { ip_pool_id: null })
  return getDb().prepare('DELETE FROM ip_pool WHERE id = ?').run(id)
}

export function recordIpPoolCheck(
  id: number,
  result: { ok: boolean; ip?: string | null; error?: string | null }
) {
  const entry = getIpPoolEntry(id)
  const safeError = result.error && entry
    ? redactProxyError(result.error, entry.proxy_url)
    : result.error
  getDb().prepare(`
    UPDATE ip_pool
    SET last_ip = ?, last_check_ok = ?, last_checked_at = datetime('now'), last_error = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(result.ip || null, result.ok ? 1 : 0, safeError || null, id)
  return getIpPoolEntry(id)
}

export function planStableIpAssignments(
  accounts: Array<Pick<Account, 'id' | 'ip_pool_id'>>,
  entries: Array<Pick<IpPoolEntry, 'id' | 'enabled'>>,
  blockSize: number
): IpAssignmentChange[] {
  const enabled = entries
    .filter(entry => Boolean(entry.enabled))
    .map(entry => ({ id: entry.id, count: 0 }))
  const enabledIds = new Set(enabled.map(entry => entry.id))
  const pending: Array<Pick<Account, 'id' | 'ip_pool_id'>> = []

  for (const account of accounts) {
    if (account.ip_pool_id !== null && enabledIds.has(account.ip_pool_id)) {
      enabled.find(entry => entry.id === account.ip_pool_id)!.count++
    } else {
      pending.push(account)
    }
  }

  const changes: IpAssignmentChange[] = []
  pending.sort((a, b) => a.id - b.id)
  if (!enabled.length) {
    for (const account of pending) {
      if (account.ip_pool_id !== null) changes.push({ accountId: account.id, ipPoolId: null })
    }
    return changes
  }

  let cursor = 0
  while (cursor < pending.length) {
    enabled.sort((a, b) => a.count - b.count || a.id - b.id)
    const target = enabled[0]!
    const remainingInBlock = blockSize - (target.count % blockSize || 0)
    const take = Math.min(remainingInBlock, pending.length - cursor)
    for (let offset = 0; offset < take; offset++) {
      const account = pending[cursor + offset]!
      if (account.ip_pool_id !== target.id) {
        changes.push({ accountId: account.id, ipPoolId: target.id })
      }
    }
    target.count += take
    cursor += take
  }
  return changes
}

export function ensureStableIpAssignments() {
  const changes = planStableIpAssignments(
    listAccounts(),
    listIpPoolEntries(),
    getIpPoolBlockSize()
  )
  for (const change of changes) {
    updateAccount(change.accountId, { ip_pool_id: change.ipPoolId })
  }
  return changes
}

export function ensureAccountIpAssignment(id: number) {
  const account = getAccount(id)
  if (!account) return undefined
  if (account.ip_pool_id !== null) {
    const entry = getIpPoolEntry(account.ip_pool_id)
    if (entry?.enabled) return account
  }
  ensureStableIpAssignments()
  return getAccount(id)
}
