import { createProxyFetch } from '../../../utils/account-fetch'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const id = Number(getRouterParam(event, 'id'))
  const entry = getIpPoolEntry(id)
  if (!entry) throw createError({ statusCode: 404, statusMessage: 'Proxy not found' })

  try {
    const fetchImpl = createProxyFetch(entry.id, entry.proxy_url)
    const response = await fetchImpl('https://api64.ipify.org?format=json', {
      signal: AbortSignal.timeout(10_000),
      headers: { accept: 'application/json' }
    })
    const body = await response.json() as { ip?: string }
    if (!response.ok || !body.ip) throw new Error(`Check failed with status ${response.status}`)
    recordIpPoolCheck(id, { ok: true, ip: body.ip })
    return { ok: true, ip: body.ip }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    recordIpPoolCheck(id, { ok: false, error: message })
    return { ok: false, error: message }
  }
})
