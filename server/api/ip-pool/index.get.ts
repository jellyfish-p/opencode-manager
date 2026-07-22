export default defineEventHandler((event) => {
  requireAuth(event)
  const entries = listPublicIpPoolEntries()
  return {
    entries,
    block_size: getIpPoolBlockSize(),
    assigned_accounts: entries.reduce((sum, entry) => sum + entry.account_count, 0)
  }
})
