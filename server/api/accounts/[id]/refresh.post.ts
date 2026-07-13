export default defineEventHandler(async (event) => {
  requireAuth(event)
  const id = Number(getRouterParam(event, 'id'))
  const account = await refreshAccount(id)
  return toPublicAccount(account)
})
