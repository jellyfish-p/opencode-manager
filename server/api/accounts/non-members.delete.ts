export default defineEventHandler((event) => {
  requireAuth(event)
  const result = deleteNonMemberAccounts()
  return { ok: true, deleted: result.changes }
})
