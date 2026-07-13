export default defineTask({
  meta: {
    name: 'refresh-accounts',
    description: 'Refresh all OpenCode accounts usage data'
  },
  async run() {
    const results = await refreshAllAccounts()
    return {
      result: {
        count: results.length,
        active: results.filter(a => a.status === 'active').length,
        error: results.filter(a => a.status === 'error').length
      }
    }
  }
})
