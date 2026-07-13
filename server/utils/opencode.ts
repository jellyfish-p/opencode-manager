export interface UsageBucket {
  status: string
  resetInSec: number
  usagePercent: number
}

export interface OpenCodeAccountInfo {
  email: string | null
  workspaceId: string | null
  workspaceName: string | null
  balance: number | null
  rollingUsage: number | null
  rollingResetSec: number | null
  weeklyUsage: number | null
  weeklyResetSec: number | null
  monthlyUsage: number | null
  monthlyResetSec: number | null
  referralCode: string | null
  subscriptionStatus: string | null
}

const BASE = 'https://opencode.ai'
const LOCALE = 'zh'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export function buildAuthCookie(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new Error('auth cookie value is required')
  }

  let authValue = trimmed

  if (trimmed.includes('=')) {
    const authPart = trimmed
      .split(';')
      .map(part => part.trim())
      .find(part => part.slice(0, part.indexOf('=')).trim().toLowerCase() === 'auth')

    if (!authPart) {
      throw new Error('auth cookie is missing')
    }

    authValue = authPart.slice(authPart.indexOf('=') + 1).trim()
  }

  if (!authValue) {
    throw new Error('auth cookie value is required')
  }

  return `auth=${authValue}; oc_locale=${LOCALE}`
}

function commonHeaders(cookie: string): Record<string, string> {
  return {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': LOCALE,
    'user-agent': UA,
    cookie,
    referer: `${BASE}/${LOCALE}/go`,
    'upgrade-insecure-requests': '1'
  }
}

function extractWorkspaceId(location: string | null): string | null {
  if (!location) return null
  // Location may be absolute or relative, e.g.
  // /workspace/wrk_01KXBFYHTCENYXZG6SCMVMB7YX
  // https://opencode.ai/workspace/wrk_...
  try {
    const path = location.startsWith('http')
      ? new URL(location).pathname
      : location
    const m = path.match(/\/workspace\/(wrk_[A-Z0-9]+)/i)
    return m?.[1] || null
  } catch {
    const m = location.match(/\/workspace\/(wrk_[A-Z0-9]+)/i)
    return m?.[1] || null
  }
}

function parseHydration(html: string): OpenCodeAccountInfo {
  const result: OpenCodeAccountInfo = {
    email: null,
    workspaceId: null,
    workspaceName: null,
    balance: null,
    rollingUsage: null,
    rollingResetSec: null,
    weeklyUsage: null,
    weeklyResetSec: null,
    monthlyUsage: null,
    monthlyResetSec: null,
    referralCode: null,
    subscriptionStatus: null
  }

  const emailMatch = html.match(/\$R\[28\]\(\$R\[\d+\],\s*"([^"]+@[^"]+)"\)/)
  if (emailMatch) result.email = emailMatch[1] || null

  const workspaceMatch = html.match(
    /id:\s*"((?:wrk_)[A-Z0-9]+)"\s*,\s*name:\s*"([^"]*)"/i
  )
  if (workspaceMatch) {
    result.workspaceId = workspaceMatch[1] || null
    result.workspaceName = workspaceMatch[2] || null
  }

  const balanceMatch = html.match(/balance:\s*(-?\d+(?:\.\d+)?)/)
  if (balanceMatch) result.balance = Number(balanceMatch[1])

  const rollingMatch = html.match(
    /rollingUsage:\s*\$R\[\d+\]\s*=\s*\{\s*status:\s*"([^"]+)"\s*,\s*resetInSec:\s*(\d+)\s*,\s*usagePercent:\s*(\d+(?:\.\d+)?)/
  )
  if (rollingMatch) {
    result.rollingUsage = Number(rollingMatch[3])
    result.rollingResetSec = Number(rollingMatch[2])
  }

  const weeklyMatch = html.match(
    /weeklyUsage:\s*\$R\[\d+\]\s*=\s*\{\s*status:\s*"([^"]+)"\s*,\s*resetInSec:\s*(\d+)\s*,\s*usagePercent:\s*(\d+(?:\.\d+)?)/
  )
  if (weeklyMatch) {
    result.weeklyUsage = Number(weeklyMatch[3])
    result.weeklyResetSec = Number(weeklyMatch[2])
  }

  const monthlyMatch = html.match(
    /monthlyUsage:\s*\$R\[\d+\]\s*=\s*\{\s*status:\s*"([^"]+)"\s*,\s*resetInSec:\s*(\d+)\s*,\s*usagePercent:\s*(\d+(?:\.\d+)?)/
  )
  if (monthlyMatch) {
    result.monthlyUsage = Number(monthlyMatch[3])
    result.monthlyResetSec = Number(monthlyMatch[2])
  }

  const referralMatch = html.match(/referralCode:\s*"([A-Z0-9]+)"/i)
  if (referralMatch) result.referralCode = referralMatch[1] || null

  if (html.includes('您已订阅 OpenCode Go') || html.includes('subscribed to OpenCode Go')) {
    result.subscriptionStatus = 'active'
  } else if (/liteSubscriptionID:\s*"[^"]+"/.test(html)) {
    result.subscriptionStatus = 'active'
  } else {
    result.subscriptionStatus = 'inactive'
  }

  return result
}

async function resolveWorkspaceId(cookie: string): Promise<string> {
  const authRes = await fetch(`${BASE}/auth`, {
    method: 'GET',
    redirect: 'manual',
    headers: commonHeaders(cookie)
  })

  const location = authRes.headers.get('location')
  let workspaceId: string | null = null

  if ([301, 302, 303, 307, 308].includes(authRes.status)) {
    workspaceId = extractWorkspaceId(location)
    if (!workspaceId) {
      throw new Error(
        `Auth redirected but not to workspace (status ${authRes.status}, location: ${location || 'none'}). Cookie may be invalid or expired.`
      )
    }
  } else if (authRes.status === 200) {
    const body = await authRes.text().catch(() => '')
    workspaceId = extractWorkspaceId(body)
  }

  if (!workspaceId) {
    throw new Error(
      `Failed to resolve workspace from /auth (status ${authRes.status}, location: ${location || 'none'}). Cookie may be invalid or expired.`
    )
  }

  return workspaceId
}

async function loadWorkspace(cookie: string, workspaceId: string): Promise<OpenCodeAccountInfo> {
  const goRes = await fetch(`${BASE}/workspace/${workspaceId}/go`, {
    method: 'GET',
    redirect: 'follow',
    headers: commonHeaders(cookie)
  })

  if (!goRes.ok) {
    throw new Error(`Failed to load workspace page (status ${goRes.status})`)
  }

  let finalPath = ''
  try {
    finalPath = new URL(goRes.url).pathname
  } catch {
    // An empty or invalid final URL is not a valid workspace response.
  }

  if (!finalPath.startsWith('/workspace/')) {
    throw new Error(
      `Workspace page redirected outside workspace (path: ${finalPath || 'unknown'})`
    )
  }

  const html = await goRes.text()
  const info = parseHydration(html)

  if (!info.email && !info.workspaceId) {
    throw new Error('Unable to parse account data from SSR page')
  }

  info.workspaceId = info.workspaceId || workspaceId
  return info
}

export async function fetchOpenCodeAccount(
  authCookie: string,
  cachedWorkspaceId?: string | null
): Promise<OpenCodeAccountInfo> {
  const cookie = buildAuthCookie(authCookie)
  const cachedId = cachedWorkspaceId?.trim()

  if (cachedId) {
    try {
      return await loadWorkspace(cookie, cachedId)
    } catch {
      // Resolve once through /auth below and replace the stale cache.
    }
  }

  const workspaceId = await resolveWorkspaceId(cookie)
  return loadWorkspace(cookie, workspaceId)
}

export async function fetchOpenCodeApiKey(
  authCookie: string,
  workspaceId: string
): Promise<string | null> {
  const cookie = buildAuthCookie(authCookie)
  const response = await fetch(`${BASE}/workspace/${workspaceId}/keys`, {
    method: 'GET',
    redirect: 'follow',
    headers: commonHeaders(cookie)
  })
  if (!response.ok) {
    throw new Error(`Failed to load API keys page (status ${response.status})`)
  }
  const html = await response.text()
  return html.match(/key:\s*"(sk-[^"\\]+)"/)?.[1] || null
}
