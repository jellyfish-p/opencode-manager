export default defineEventHandler((event) => {
  requireAuth(event)
  return listAccounts().map(toPublicAccount)
})
