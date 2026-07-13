export default defineEventHandler((event) => {
  requireAuth(event)
  const accounts = listAccounts()

  const members = accounts.filter(account => account.subscription_status === 'active')
  return {
    total: accounts.length,
    active: accounts.filter(a => a.status === 'active').length,
    error: accounts.filter(a => a.status === 'error').length,
    disabled: accounts.filter(a => a.status === 'disabled').length,
    pending: accounts.filter(a => a.status === 'pending').length,
    members: members.length,
    nonMembers: accounts.length - members.length,
    avgRolling: avg(members.map(a => a.rolling_usage)),
    avgWeekly: avg(members.map(a => a.weekly_usage)),
    avgMonthly: avg(members.map(a => a.monthly_usage)),
    totalBalance: accounts.reduce((s, a) => s + (a.balance || 0), 0),
    rollingUsedAmount: sumUsage(members, 'rolling_usage', QUOTA_LIMITS_USD.rolling),
    weeklyUsedAmount: sumUsage(members, 'weekly_usage', QUOTA_LIMITS_USD.weekly),
    monthlyUsedAmount: sumUsage(members, 'monthly_usage', QUOTA_LIMITS_USD.monthly),
    rollingLimitAmount: members.length * QUOTA_LIMITS_USD.rolling,
    weeklyLimitAmount: members.length * QUOTA_LIMITS_USD.weekly,
    monthlyLimitAmount: members.length * QUOTA_LIMITS_USD.monthly
  }
})

function sumUsage(
  accounts: ReturnType<typeof listAccounts>,
  field: 'rolling_usage' | 'weekly_usage' | 'monthly_usage',
  limit: number
) {
  return Math.round(accounts.reduce((sum, account) => sum + usedAmount(account[field], limit), 0) * 100) / 100
}

function avg(values: Array<number | null | undefined>) {
  const nums = values.filter((v): v is number => typeof v === 'number')
  if (!nums.length) return 0
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10
}
