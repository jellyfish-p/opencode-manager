export default defineTask({
  meta: {
    name: 'refresh-memberships',
    description: 'Refresh account membership and quota state periodically'
  },
  async run() {
    const results = await refreshDueMembershipAccounts()
    return {
      result: {
        count: results.length,
        active: results.filter(account => account.status === 'active').length,
        disabled: results.filter(account => account.status === 'disabled').length,
        error: results.filter(account => account.status === 'error').length
      }
    }
  }
})
