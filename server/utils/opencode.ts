import { validateAuthCookieValue } from './auth-cookie'

export interface UsageBucket {
  status: string
  resetInSec: number
  usagePercent: number
}

export interface OpenCodeWorkspace {
  id: string
  name: string | null
}

export interface OpenCodeAccountInfo {
  email: string | null
  workspaceId: string | null
  workspaceName: string | null
  workspaces: OpenCodeWorkspace[]
  balance: number | null
  rollingUsage: number | null
  rollingResetSec: number | null
  weeklyUsage: number | null
  weeklyResetSec: number | null
  monthlyUsage: number | null
  monthlyResetSec: number | null
  referralCode: string | null
  availableReferralRewardIds: string[]
  usedReferralRewardIds: string[]
  referralApplyServerId: string | null
  liteSubscriptionId: string | null
  billingPortalServerId: string | null
  subscriptionStatus: string | null
}

export interface SubscriptionCancellationResult {
  alreadyCancelled: boolean
  currentPeriodEnd: string | null
}

export type OpenCodeAccountLoadStage = 'workspace-page' | 'route-modules'

export interface ReferralUsagePreviewItem {
  beforePercent: number
  afterPercent: number
  resetInSec: number
}

export interface ReferralUsagePreview {
  rollingUsage: ReferralUsagePreviewItem
  weeklyUsage: ReferralUsagePreviewItem
  monthlyUsage: ReferralUsagePreviewItem
}

const BASE = 'https://opencode.ai'
const LOCALE = 'zh'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const REQUEST_TIMEOUT_MS = 20_000

interface RouteModuleCache {
  signature: string
  assets: string[]
  modules: string[]
  refreshing: Promise<boolean> | null
}

let routeModuleCache: RouteModuleCache | null = null

export function buildAuthCookie(input: string): string {
  return `auth=${validateAuthCookieValue(input)}; oc_locale=${LOCALE}`
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

function fetchWithDeadline(
  fetchImpl: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {}
) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout
  return fetchImpl(input, { ...init, signal })
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

export function parseOpenCodeHydration(
  html: string,
  currentWorkspaceId?: string | null
): OpenCodeAccountInfo {
  const result: OpenCodeAccountInfo = {
    email: null,
    workspaceId: null,
    workspaceName: null,
    workspaces: [],
    balance: null,
    rollingUsage: null,
    rollingResetSec: null,
    weeklyUsage: null,
    weeklyResetSec: null,
    monthlyUsage: null,
    monthlyResetSec: null,
    referralCode: null,
    availableReferralRewardIds: [],
    usedReferralRewardIds: [],
    referralApplyServerId: null,
    liteSubscriptionId: null,
    billingPortalServerId: null,
    subscriptionStatus: null
  }

  const emailMatch = html.match(/\$R\[28\]\(\$R\[\d+\],\s*"([^"]+@[^"]+)"\)/)
  if (emailMatch) result.email = emailMatch[1] || null

  const workspaces = new Map<string, OpenCodeWorkspace>()
  for (const match of html.matchAll(
    /id:\s*"((?:wrk_)[A-Z0-9]+)"\s*,\s*name:\s*"([^"]*)"/gi
  )) {
    const id = match[1]
    if (id && !workspaces.has(id)) {
      workspaces.set(id, { id, name: match[2] || null })
    }
  }
  result.workspaces = [...workspaces.values()]

  const selectedWorkspace = currentWorkspaceId
    ? workspaces.get(currentWorkspaceId)
    : result.workspaces[0]
  if (selectedWorkspace) {
    result.workspaceId = selectedWorkspace.id
    result.workspaceName = selectedWorkspace.name
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

  result.availableReferralRewardIds = [
    ...html.matchAll(
      /id:\s*"(ref_[A-Z0-9]+)"\s*,\s*source:\s*"(?:inviter|invitee)"\s*,\s*status:\s*"available"/gi
    )
  ].map(match => match[1]!)
  result.usedReferralRewardIds = [
    ...new Set(
      [...html.matchAll(
        /id:\s*"(ref_[A-Z0-9]+)"\s*,\s*source:\s*"(?:inviter|invitee)"\s*,\s*status:\s*"(?:applied|used)"/gi
      )].map(match => match[1]!)
    )
  ]

  const liteSubscriptionMatch = html.match(/liteSubscriptionID:\s*"([^"]+)"/i)
  if (liteSubscriptionMatch) result.liteSubscriptionId = liteSubscriptionMatch[1] || null

  if (html.includes('您已订阅 OpenCode Go') || html.includes('subscribed to OpenCode Go')) {
    result.subscriptionStatus = 'active'
  } else if (/liteSubscriptionID:\s*"[^"]+"/.test(html)) {
    result.subscriptionStatus = 'active'
  } else {
    result.subscriptionStatus = 'inactive'
  }

  return result
}

export function serializeOpenCodeServerArgs(args: string[]) {
  return {
    t: {
      t: 9,
      i: 0,
      l: args.length,
      a: args.map(value => ({ t: 1, s: value })),
      o: 0
    },
    f: 31,
    m: []
  }
}

async function loadOpenCodeRouteModules(
  html: string,
  fetchImpl: typeof fetch = fetch
) {
  const assets = [
    ...new Set(
      [...html.matchAll(/<link[^>]+href="([^"]+\.js)"[^>]+rel="modulepreload"/gi)]
        .map(match => match[1]!)
    )
  ]

  const signature = assets.join('|')
  if (!signature) return []

  if (routeModuleCache?.signature === signature) {
    if (routeModuleCache.modules.length) return routeModuleCache.modules
    await refreshRouteModuleCache(routeModuleCache, fetchImpl)
    return routeModuleCache.modules
  }

  const cache: RouteModuleCache = {
    signature,
    assets,
    modules: [],
    refreshing: null
  }
  routeModuleCache = cache
  const refreshed = await refreshRouteModuleCache(cache, fetchImpl)
  if (!refreshed && routeModuleCache === cache) routeModuleCache = null
  return cache.modules
}

async function fetchOpenCodeRouteModules(
  assets: string[],
  fetchImpl: typeof fetch
) {
  const orderedAssets = [...assets].reverse()
  const fetchModule = async (asset: string) => {
    try {
      const response = await fetchWithDeadline(fetchImpl, new URL(asset, BASE))
      return response.ok ? await response.text() : ''
    } catch {
      return ''
    }
  }

  const preferredAsset = orderedAssets.shift()
  if (!preferredAsset) return []

  const preferredModule = await fetchModule(preferredAsset)
  if (
    /go\.referral\.reward\.apply/i.test(preferredModule) ||
    /createSessionUrl_action/i.test(preferredModule)
  ) {
    return [preferredModule]
  }

  const remainingModules = await Promise.all(
    orderedAssets.map(fetchModule)
  )
  return [preferredModule, ...remainingModules]
}

function refreshRouteModuleCache(
  cache: RouteModuleCache,
  fetchImpl: typeof fetch
) {
  if (cache.refreshing) return cache.refreshing

  let refresh!: Promise<boolean>
  refresh = (async () => {
    const modules = await fetchOpenCodeRouteModules(cache.assets, fetchImpl)
    if (!modules.some(Boolean)) return false
    cache.modules = modules
    return true
  })().finally(() => {
    if (cache.refreshing === refresh) cache.refreshing = null
  })
  cache.refreshing = refresh
  return refresh
}

export function clearOpenCodeRouteModuleCache() {
  routeModuleCache = null
}

export async function refreshOpenCodeRouteModuleCache(
  fetchImpl: typeof fetch = fetch
) {
  const cache = routeModuleCache
  if (!cache) return false
  return refreshRouteModuleCache(cache, fetchImpl)
}

export async function discoverReferralApplyServerId(
  html: string,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  const modules = await loadOpenCodeRouteModules(html, fetchImpl)
  for (const source of modules) {
    const match = source.match(
      /createServerReference\("([a-f0-9]{64})"\)[\s\S]{0,300}?"go\.referral\.reward\.apply"/i
    )
    if (match) return match[1] || null
  }
  return null
}

export async function discoverBillingPortalServerId(
  html: string,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  const modules = await loadOpenCodeRouteModules(html, fetchImpl)
  for (const source of modules) {
    const match = source.match(
      /createSessionUrl_action\s*=\s*createServerReference\("([a-f0-9]{64})"\)/i
    )
    if (match) return match[1] || null
  }
  return null
}

export async function applyOpenCodeReferralReward(
  authCookie: string,
  workspaceId: string,
  referralId: string,
  serverId: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const cookie = buildAuthCookie(authCookie)
  const response = await fetchWithDeadline(fetchImpl, `${BASE}/_server`, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'content-type': 'application/json',
      cookie,
      referer: `${BASE}/workspace/${workspaceId}/go`,
      'user-agent': UA,
      'x-server-id': serverId,
      'x-server-instance': 'server-fn:0'
    },
    body: JSON.stringify(serializeOpenCodeServerArgs([workspaceId, referralId]))
  })

  if (!response.ok || response.headers.has('x-error')) {
    const detail = (await response.text().catch(() => '')).slice(0, 300)
    throw new Error(
      `Failed to apply referral reward (status ${response.status}${detail ? `: ${detail}` : ''})`
    )
  }
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function periodEndFromUnix(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return new Date(value * 1000).toISOString()
}

export async function cancelOpenCodeSubscriptionRenewal(
  authCookie: string,
  workspaceId: string,
  subscriptionId: string,
  serverId: string,
  fetchImpl: typeof fetch = fetch
): Promise<SubscriptionCancellationResult> {
  const cookie = buildAuthCookie(authCookie)
  const returnUrl = `${BASE}/workspace/${workspaceId}/go`
  const portalResponse = await fetchWithDeadline(fetchImpl, `${BASE}/_server`, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'content-type': 'application/json',
      cookie,
      referer: returnUrl,
      'user-agent': UA,
      'x-server-id': serverId,
      'x-server-instance': 'server-fn:0'
    },
    body: JSON.stringify(serializeOpenCodeServerArgs([workspaceId, returnUrl]))
  })
  const portalBody = await portalResponse.text()
  const portalUrl = portalBody.match(/https:\/\/billing\.stripe\.com\/p\/session\/[^"\\]+/)?.[0]
  if (!portalResponse.ok || portalResponse.headers.has('x-error') || !portalUrl) {
    throw new Error(`Failed to create billing portal session (status ${portalResponse.status})`)
  }

  const portalPage = await fetchWithDeadline(fetchImpl, portalUrl, {
    headers: { accept: 'text/html', 'user-agent': UA }
  })
  if (!portalPage.ok) {
    throw new Error(`Failed to load billing portal (status ${portalPage.status})`)
  }
  const portalHtml = await portalPage.text()
  const preloadRaw = portalHtml.match(
    /<script[^>]+id="preloaded_json"[^>]*>([\s\S]*?)<\/script>/i
  )?.[1]
  if (!preloadRaw) throw new Error('Billing portal session data not found')

  const preload = JSON.parse(decodeHtmlEntities(preloadRaw)) as {
    session_api_key?: string
    portal_session_id?: string
  }
  if (!preload.session_api_key || !preload.portal_session_id) {
    throw new Error('Billing portal credentials not found')
  }

  let stripeVersion = '2026-06-24.dahlia'
  const subscriptionUrl = `https://billing.stripe.com/v1/billing_portal/sessions/${preload.portal_session_id}/subscriptions/${subscriptionId}`
  const stripeRequest = async (url: string, init: RequestInit = {}) => {
    const response = await fetchWithDeadline(fetchImpl, url, {
      ...init,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${preload.session_api_key}`,
        'stripe-version': stripeVersion,
        'user-agent': UA,
        referer: portalUrl,
        ...init.headers
      }
    })
    if (response.status === 400) {
      const clone = response.clone()
      const body = await clone.json().catch(() => null) as { error?: { message?: string } } | null
      const suggested = body?.error?.message?.match(/\d{4}-\d{2}-\d{2}\.[a-z]+/i)?.[0]
      if (suggested && suggested !== stripeVersion) {
        stripeVersion = suggested
        return fetchWithDeadline(fetchImpl, url, {
          ...init,
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${preload.session_api_key}`,
            'stripe-version': stripeVersion,
            'user-agent': UA,
            referer: portalUrl,
            ...init.headers
          }
        })
      }
    }
    return response
  }

  const readSubscription = async () => {
    const response = await stripeRequest(subscriptionUrl)
    const body = await response.json().catch(() => null) as {
      id?: string
      cancel_at_period_end?: boolean
      current_period_end?: number
      error?: { message?: string }
    } | null
    if (!response.ok || body?.id !== subscriptionId) {
      throw new Error(body?.error?.message || `Failed to load subscription (status ${response.status})`)
    }
    return body
  }

  const before = await readSubscription()
  if (before.cancel_at_period_end) {
    return { alreadyCancelled: true, currentPeriodEnd: periodEndFromUnix(before.current_period_end) }
  }

  const cancelResponse = await stripeRequest(`${subscriptionUrl}/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: ''
  })
  if (!cancelResponse.ok) {
    const body = await cancelResponse.json().catch(() => null) as { error?: { message?: string } } | null
    throw new Error(body?.error?.message || `Failed to cancel subscription (status ${cancelResponse.status})`)
  }

  const after = await readSubscription()
  if (!after.cancel_at_period_end) {
    throw new Error('Subscription renewal is still enabled after cancellation')
  }
  return { alreadyCancelled: false, currentPeriodEnd: periodEndFromUnix(after.current_period_end) }
}

async function resolveWorkspaceId(cookie: string, fetchImpl: typeof fetch): Promise<string> {
  const authRes = await fetchWithDeadline(fetchImpl, `${BASE}/auth`, {
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

async function loadWorkspace(
  cookie: string,
  workspaceId: string,
  fetchImpl: typeof fetch,
  onStage?: (stage: OpenCodeAccountLoadStage) => void
): Promise<OpenCodeAccountInfo> {
  onStage?.('workspace-page')
  const goRes = await fetchWithDeadline(fetchImpl, `${BASE}/workspace/${workspaceId}/go`, {
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

  const finalWorkspaceId = extractWorkspaceId(goRes.url)
  if (!finalPath.startsWith('/workspace/') || !finalWorkspaceId) {
    throw new Error(
      `Workspace page redirected outside workspace (path: ${finalPath || 'unknown'})`
    )
  }

  const html = await goRes.text()
  const info = parseOpenCodeHydration(html, finalWorkspaceId)

  if (!info.email && !info.workspaceId) {
    throw new Error('Unable to parse account data from SSR page')
  }

  info.workspaceId = finalWorkspaceId
  if (info.availableReferralRewardIds.length || info.liteSubscriptionId) {
    onStage?.('route-modules')
    const [referralServerId, billingServerId] = await Promise.all([
      info.availableReferralRewardIds.length
        ? discoverReferralApplyServerId(html, fetchImpl)
        : Promise.resolve(null),
      info.liteSubscriptionId
        ? discoverBillingPortalServerId(html, fetchImpl)
        : Promise.resolve(null)
    ])
    info.referralApplyServerId = referralServerId
    info.billingPortalServerId = billingServerId
  }
  return info
}

export async function fetchOpenCodeAccount(
  authCookie: string,
  cachedWorkspaceId?: string | null,
  fetchImpl: typeof fetch = fetch,
  onStage?: (stage: OpenCodeAccountLoadStage) => void
): Promise<OpenCodeAccountInfo> {
  const cookie = buildAuthCookie(authCookie)
  const cachedId = cachedWorkspaceId?.trim()

  if (cachedId) {
    return loadWorkspace(cookie, cachedId, fetchImpl, onStage)
  }

  const workspaceId = await resolveWorkspaceId(cookie, fetchImpl)
  return loadWorkspace(cookie, workspaceId, fetchImpl, onStage)
}

export async function fetchOpenCodeAccounts(
  authCookie: string,
  cachedWorkspaceId?: string | null,
  fetchImpl: typeof fetch = fetch
): Promise<OpenCodeAccountInfo[]> {
  const cookie = buildAuthCookie(authCookie)
  const workspaceId = cachedWorkspaceId?.trim() || await resolveWorkspaceId(cookie, fetchImpl)
  const primary = await loadWorkspace(cookie, workspaceId, fetchImpl)
  const workspaceIds = [
    ...new Set([
      primary.workspaceId,
      ...primary.workspaces.map(workspace => workspace.id)
    ].filter((id): id is string => Boolean(id)))
  ]
  const infos = [primary]

  for (const id of workspaceIds) {
    if (id === primary.workspaceId) continue
    infos.push(await loadWorkspace(cookie, id, fetchImpl))
  }

  return infos
}

export async function fetchOpenCodeApiKey(
  authCookie: string,
  workspaceId: string,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  const cookie = buildAuthCookie(authCookie)
  const response = await fetchWithDeadline(fetchImpl, `${BASE}/workspace/${workspaceId}/keys`, {
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
