export default defineEventHandler((event) => {
  requireAuth(event)

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid account id' })
  }

  return {
    progress: getAccountRefreshProgress(id)
  }
})
