export default defineEventHandler(async (event) => {
  requireAuth(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid account ID' })
  }

  const result = await cancelAccountRenewal(id)
  return { ...result, account: toPublicAccount(result.account) }
})
