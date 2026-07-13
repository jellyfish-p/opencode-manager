export default defineEventHandler((event) => {
  requireAuth(event)
  const id = Number(getRouterParam(event, 'id'))
  const account = getAccount(id)
  if (!account) {
    throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  }
  return toPublicAccount(account)
})
