import type { H3Event } from 'h3'
import type { Account } from './db'

const GO_BASE = 'https://opencode.ai/zen/go/v1'
const ACCOUNT_ERROR_STATUSES = new Set([401, 403, 408, 409, 429])

function jsonError(status: number, message: string, code: string) {
  return new Response(JSON.stringify({
    error: { message, type: 'server_error', code }
  }), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function upstreamHeaders(event: H3Event, apiKey?: string) {
  const headers = new Headers()
  const contentType = getHeader(event, 'content-type')
  const accept = getHeader(event, 'accept')
  if (contentType) headers.set('content-type', contentType)
  if (accept) headers.set('accept', accept)
  if (apiKey) headers.set('authorization', `Bearer ${apiKey}`)
  return headers
}

async function refreshAfterUpstreamError(accountId: number): Promise<Account | null> {
  try {
    return await refreshAccount(accountId)
  } catch {
    // The next scheduled refresh will retry the account.
    return null
  }
}

async function replayableResponse(response: Response): Promise<Response> {
  const body = await response.arrayBuffer()
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  })
}

export async function proxyChatCompletions(event: H3Event): Promise<Response> {
  const body = await readRawBody(event)
  if (!body) return jsonError(400, 'Request body is required', 'invalid_request')

  const candidates = reserveProxyCandidates()
  if (!candidates.length) {
    return jsonError(503, 'No active OpenCode Go accounts are available', 'pool_unavailable')
  }

  let lastResponse: Response | null = null
  for (const account of candidates) {
    try {
      const response = await fetch(`${GO_BASE}/chat/completions`, {
        method: 'POST',
        headers: upstreamHeaders(event, account.upstream_api_key!),
        body
      })
      if (response.ok) return response

      if (!ACCOUNT_ERROR_STATUSES.has(response.status) && response.status < 500) {
        return response
      }
      lastResponse = await replayableResponse(response)
      const refreshed = await refreshAfterUpstreamError(account.id)
      if (
        refreshed?.status === 'active' &&
        refreshed.upstream_api_key &&
        (refreshed.upstream_api_key !== account.upstream_api_key ||
          refreshed.last_referral_reward_applied_at !== account.last_referral_reward_applied_at)
      ) {
        const retry = await fetch(`${GO_BASE}/chat/completions`, {
          method: 'POST',
          headers: upstreamHeaders(event, refreshed.upstream_api_key),
          body
        })
        if (retry.ok || (!ACCOUNT_ERROR_STATUSES.has(retry.status) && retry.status < 500)) {
          return retry
        }
        lastResponse = await replayableResponse(retry)
      }
    } catch {
      await refreshAfterUpstreamError(account.id)
    }
  }

  return lastResponse || jsonError(502, 'All upstream accounts failed', 'upstream_error')
}

export async function proxyModels(event: H3Event): Promise<Response> {
  const account = getProxyCandidates()[0]
  try {
    const response = await fetch(`${GO_BASE}/models`, {
      headers: upstreamHeaders(event, account?.upstream_api_key || undefined)
    })
    if (!response.ok && account) await refreshAfterUpstreamError(account.id)
    return response
  } catch {
    return jsonError(502, 'Failed to load upstream models', 'upstream_error')
  }
}
