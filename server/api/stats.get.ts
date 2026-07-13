export default defineEventHandler((event) => {
  requireAuth(event)
  const accounts = listAccounts()

  return {
    total: accounts.length,
    active: accounts.filter(a => a.status === 'active').length,
    error: accounts.filter(a => a.status === 'error').length,
    disabled: accounts.filter(a => a.status === 'disabled').length,
    pending: accounts.filter(a => a.status === 'pending').length,
    avgRolling: avg(accounts.map(a => a.rolling_usage)),
    avgWeekly: avg(accounts.map(a => a.weekly_usage)),
    avgMonthly: avg(accounts.map(a => a.monthly_usage)),
    totalBalance: accounts.reduce((s, a) => s + (a.balance || 0), 0)
  }
})

function avg(values: Array<number | null | undefined>) {
  const nums = values.filter((v): v is number => typeof v === 'number')
  if (!nums.length) return 0
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10
}
