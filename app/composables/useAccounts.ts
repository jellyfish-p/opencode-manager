export interface Account {
  id: number
  name: string | null
  email: string | null
  workspace_id: string | null
  workspace_name: string | null
  balance: number | null
  rolling_usage: number | null
  rolling_reset_sec: number | null
  weekly_usage: number | null
  weekly_reset_sec: number | null
  monthly_usage: number | null
  monthly_reset_sec: number | null
  rolling_reset_at: string | null
  weekly_reset_at: string | null
  monthly_reset_at: string | null
  next_quota_refresh_at: string | null
  quota_refreshed_at: string | null
  referral_code: string | null
  last_referral_reward_id: string | null
  last_referral_reward_applied_at: string | null
  subscription_status: string | null
  subscription_cancelled_at: string | null
  subscription_cancel_checked_at: string | null
  subscription_ends_at: string | null
  subscription_cancel_error: string | null
  has_upstream_api_key: boolean
  ip_pool_id: number | null
  status: 'pending' | 'active' | 'error' | 'disabled'
  disabled_reason: string | null
  auto_enable_at: string | null
  risk_control_checked_at: string | null
  risk_control_detected_at: string | null
  last_error: string | null
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

export interface Stats {
  total: number
  active: number
  error: number
  disabled: number
  pending: number
  members: number
  nonMembers: number
  avgRolling: number
  avgWeekly: number
  avgMonthly: number
  totalBalance: number
  rollingUsedAmount: number
  weeklyUsedAmount: number
  monthlyUsedAmount: number
  rollingLimitAmount: number
  weeklyLimitAmount: number
  monthlyLimitAmount: number
}

export interface ReferralRewardList {
  cached: boolean
  rewardIds: string[]
  refreshedAt: string | null
}

export interface RiskControlCheckResult {
  account: Account
  blocked: boolean
  upstreamStatus: number
  errorType: string | null
  message: string | null
}

export function useAccounts() {
  const accounts = useState<Account[]>('accounts', () => [])
  const stats = useState<Stats | null>('stats', () => null)
  const loading = useState('accounts-loading', () => false)
  const requestFetch = useRequestFetch()

  async function fetchAccounts() {
    loading.value = true
    try {
      accounts.value = await requestFetch<Account[]>('/api/accounts')
    } finally {
      loading.value = false
    }
  }

  async function fetchStats() {
    stats.value = await requestFetch<Stats>('/api/stats')
  }

  async function addAccounts(payload: { name?: string; auth_cookie_values: string }) {
    const result = await requestFetch<{
      created: number
      synchronized: number
      failed: number
      accounts: Account[]
    }>('/api/accounts/batch', {
      method: 'POST',
      body: payload
    })
    const createdIds = new Set(result.accounts.map(account => account.id))
    accounts.value = [
      ...result.accounts,
      ...accounts.value.filter(account => !createdIds.has(account.id))
    ].sort((a, b) => b.id - a.id)
    void Promise.allSettled([fetchAccounts(), fetchStats()])
    return result
  }

  async function updateAccount(id: number, payload: Partial<{ name: string; auth_cookie: string; status: Account['status'] }>) {
    const account = await requestFetch<Account>(`/api/accounts/${id}`, {
      method: 'PATCH',
      body: payload
    })
    await Promise.all([fetchAccounts(), fetchStats()])
    return account
  }

  async function fetchAccountAuthCookie(id: number) {
    return requestFetch<{ auth_cookie: string }>(`/api/accounts/${id}/auth-cookie`)
  }

  async function removeAccount(id: number) {
    await requestFetch(`/api/accounts/${id}`, { method: 'DELETE' })
    await Promise.all([fetchAccounts(), fetchStats()])
  }

  async function removeNonMembers() {
    const result = await requestFetch<{ ok: boolean; deleted: number }>('/api/accounts/non-members', {
      method: 'DELETE'
    })
    await Promise.all([fetchAccounts(), fetchStats()])
    return result
  }

  async function refreshAccount(id: number) {
    const account = await requestFetch<Account>(`/api/accounts/${id}/refresh`, { method: 'POST' })
    await Promise.all([fetchAccounts(), fetchStats()])
    return account
  }

  async function fetchReferralRewards(id: number) {
    return requestFetch<ReferralRewardList>(`/api/accounts/${id}/referral-rewards`)
  }

  async function useReferralReward(id: number, rewardId: string) {
    const result = await requestFetch<{
      account: Account
      rewardId: string
      rewardIds: string[]
      refreshed: boolean
    }>(
      `/api/accounts/${id}/referral-reward`,
      { method: 'POST', body: { rewardId } }
    )
    const index = accounts.value.findIndex(account => account.id === id)
    if (index >= 0) accounts.value[index] = result.account
    void Promise.allSettled([fetchAccounts(), fetchStats()])
    return result
  }

  async function cancelRenewal(id: number) {
    const result = await requestFetch<{
      account: Account
      alreadyCancelled: boolean
      currentPeriodEnd: string | null
    }>(`/api/accounts/${id}/cancel-renewal`, { method: 'POST' })
    await Promise.all([fetchAccounts(), fetchStats()])
    return result
  }

  async function refreshAll() {
    loading.value = true
    try {
      accounts.value = await requestFetch<Account[]>('/api/accounts/refresh-all', { method: 'POST' })
      await fetchStats()
    } finally {
      loading.value = false
    }
  }

  async function checkRiskControl(id: number) {
    const result = await requestFetch<RiskControlCheckResult>(
      `/api/accounts/${id}/risk-control-check`,
      { method: 'POST' }
    )
    await Promise.all([fetchAccounts(), fetchStats()])
    return result
  }

  async function checkAllRiskControls() {
    const results = await requestFetch<RiskControlCheckResult[]>(
      '/api/accounts/risk-control/check-all',
      { method: 'POST' }
    )
    await Promise.all([fetchAccounts(), fetchStats()])
    return results
  }

  return {
    accounts,
    stats,
    loading,
    fetchAccounts,
    fetchStats,
    addAccounts,
    updateAccount,
    fetchAccountAuthCookie,
    removeAccount,
    removeNonMembers,
    refreshAccount,
    fetchReferralRewards,
    useReferralReward,
    cancelRenewal,
    refreshAll,
    checkRiskControl,
    checkAllRiskControls
  }
}
