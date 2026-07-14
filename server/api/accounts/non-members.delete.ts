export default defineEventHandler((event) => {
  requireAuth(event)
  const result = deleteNonMemberAccounts()
  rebuildAccountPollSchedule()
  return { ok: true, deleted: result.changes }
})
