export default defineEventHandler(async (event) => {
  requireAuth(event)
  const body = await readBody<{ name?: string; proxy_urls?: unknown }>(event)
  if (typeof body?.proxy_urls !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'proxy_urls is required' })
  }

  let proxyUrls: string[]
  try {
    proxyUrls = [...new Set(
      body.proxy_urls
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(normalizeProxyUrl)
    )]
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : 'Invalid proxy URL'
    })
  }
  if (!proxyUrls.length) {
    throw createError({ statusCode: 400, statusMessage: 'At least one proxy URL is required' })
  }

  const existing = new Set(listIpPoolEntries().map(entry => entry.proxy_url))
  const pending = proxyUrls.filter(proxyUrl => !existing.has(proxyUrl))
  for (const [index, proxyUrl] of pending.entries()) {
    createIpPoolEntry({
      name: body.name
        ? pending.length === 1 ? body.name : `${body.name} ${index + 1}`
        : undefined,
      proxy_url: proxyUrl
    })
  }
  const changes = ensureStableIpAssignments()
  return {
    created: pending.length,
    skipped: proxyUrls.length - pending.length,
    assigned: changes.filter(change => change.ipPoolId !== null).length,
    entries: listPublicIpPoolEntries()
  }
})
