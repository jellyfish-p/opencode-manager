export default defineEventHandler(async (event) => {
  requireAuth(event)
  const body = await readBody<{ name?: string; key?: string }>(event)
  const key = body?.key?.trim() || generateApiKey()
  if (key.length < 12) {
    throw createError({ statusCode: 400, statusMessage: 'API key must be at least 12 characters' })
  }
  try {
    const created = createManagedApiKey({
      name: body?.name?.trim() || 'Web API Key',
      key_hash: hashApiKey(key),
      key_prefix: apiKeyPrefix(key)
    })
    return {
      id: String(created.id),
      name: created.name,
      prefix: created.key_prefix,
      source: 'web',
      created_at: created.created_at,
      key
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE')) {
      throw createError({ statusCode: 409, statusMessage: 'API key already exists' })
    }
    throw error
  }
})
