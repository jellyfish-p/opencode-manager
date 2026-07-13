export default defineEventHandler((event) => {
  requireAuth(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!getAccount(id)) {
    throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  }
  deleteAccount(id)
  return { ok: true }
})
