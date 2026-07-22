export default defineEventHandler(async (event) => {
  requireAuth(event)
  const id = Number(getRouterParam(event, 'id'))
  const result = await checkAccountRiskControl(id)
  return { ...result, account: toPublicAccount(result.account) }
})
