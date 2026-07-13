export default defineEventHandler((event) => {
  requireAuth(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'config.yaml keys cannot be deleted here' })
  }
  const result = deleteManagedApiKey(id)
  if (!result.changes) throw createError({ statusCode: 404, statusMessage: 'API key not found' })
  return { ok: true }
})
