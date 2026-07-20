import type { H3Event } from 'h3'
import {
  AdaptiveProxyWorkerController,
  ProxyPoolSaturatedError,
  ProxyQueueTimeoutError,
  ProxyRequestAbortedError,
  ProxyWorkerPool
} from './proxy-worker-pool'
import { createProxyRequestLifecycle } from './proxy-request-lifecycle'

const GO_BASE = 'https://opencode.ai/zen/go/v1'
const ACCOUNT_ERROR_STATUSES = new Set([401, 403, 408, 409, 429])
const PROXY_MIN_WORKERS = positiveInteger(
  process.env.PROXY_MIN_WORKERS || process.env.PROXY_WORKERS,
  64
)
const PROXY_MAX_WORKERS = Math.max(
  PROXY_MIN_WORKERS,
  positiveInteger(process.env.PROXY_MAX_WORKERS, 1024)
)
const PROXY_QUEUE_LIMIT = positiveInteger(process.env.PROXY_QUEUE_LIMIT, 8192)
const PROXY_QUEUE_TIMEOUT_MS = positiveInteger(process.env.PROXY_QUEUE_TIMEOUT_MS, 30_000)
const PROXY_UPSTREAM_TIMEOUT_MS = positiveInteger(process.env.PROXY_UPSTREAM_TIMEOUT_MS, 10 * 60_000)
const proxyWorkers = new ProxyWorkerPool(PROXY_MIN_WORKERS, PROXY_QUEUE_LIMIT)
const proxyWorkerController = new AdaptiveProxyWorkerController(proxyWorkers, {
  minWorkers: PROXY_MIN_WORKERS,
  maxWorkers: PROXY_MAX_WORKERS
})
proxyWorkerController.start()

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

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

function refreshAfterUpstreamError(accountId: number) {
  void refreshAccount(accountId).catch(() => {
    // The in-memory polling schedule will retry this account later.
  })
}

export async function proxyChatCompletions(event: H3Event): Promise<Response> {
  const requestLifecycle = createProxyRequestLifecycle(event)
  const upstreamTimeoutSignal = AbortSignal.timeout(PROXY_UPSTREAM_TIMEOUT_MS)
  const upstreamSignal = AbortSignal.any([requestLifecycle.signal, upstreamTimeoutSignal])
  try {
    return await proxyWorkers.run(async () => {
      const body = await readRawBody(event)
      if (!body) return jsonError(400, 'Request body is required', 'invalid_request')

      const account = reserveProxyCandidate()
      if (!account) {
        return jsonError(503, 'No active OpenCode Go accounts are available', 'pool_unavailable')
      }

      try {
        const response = await fetch(`${GO_BASE}/chat/completions`, {
          method: 'POST',
          headers: upstreamHeaders(event, account.upstream_api_key!),
          body,
          signal: upstreamSignal
        })
        if (ACCOUNT_ERROR_STATUSES.has(response.status) || response.status >= 500) {
          refreshAfterUpstreamError(account.id)
        }
        return response
      } catch {
        if (requestLifecycle.signal.aborted) throw new ProxyRequestAbortedError()
        if (upstreamTimeoutSignal.aborted) {
          return jsonError(504, 'Upstream request timed out', 'upstream_timeout')
        }
        refreshAfterUpstreamError(account.id)
        return jsonError(502, 'Upstream request failed', 'upstream_error')
      }
    }, {
      signal: requestLifecycle.signal,
      queueTimeoutMs: PROXY_QUEUE_TIMEOUT_MS
    })
  } catch (error) {
    if (error instanceof ProxyRequestAbortedError) {
      return jsonError(499, 'Client closed the request', 'client_closed_request')
    }
    if (error instanceof ProxyQueueTimeoutError) {
      return jsonError(503, 'Proxy worker queue wait timed out', 'proxy_queue_timeout')
    }
    if (error instanceof ProxyPoolSaturatedError) {
      return jsonError(503, 'Proxy worker queue is full', 'proxy_saturated')
    }
    return jsonError(500, 'Proxy worker failed', 'proxy_worker_error')
  }
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
