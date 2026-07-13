export default defineEventHandler(async (event) => {
  requireAuth(event)
  const accounts = await refreshAllAccounts()
  return accounts.map(toPublicAccount)
})
