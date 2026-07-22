export default defineEventHandler((event) => {
  requireAuth(event)
  const id = Number(getRouterParam(event, 'id'))
  const result = deleteIpPoolEntry(id)
  if (!result.changes) throw createError({ statusCode: 404, statusMessage: 'Proxy not found' })
  const changes = ensureStableIpAssignments()
  return { ok: true, reassigned: changes.length }
})
