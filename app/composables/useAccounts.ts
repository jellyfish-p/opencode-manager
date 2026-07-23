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
  usedRewardIds: string[]
  refreshedAt: string | null
}

export interface AccountRefreshProgress {
  accountId: number
  status: 'running' | 'complete' | 'error'
  phase:
    | 'queued'
    | 'workspace'
    | 'referral'
    | 'subscription'
    | 'api-key'
    | 'finalizing'
    | 'complete'
  label: string
  step: number
  totalSteps: number
  percent: number
  startedAt: string
  updatedAt: string
  error: string | null
}

export interface AccountImportProgress {
  operationId: string
  status: 'running' | 'complete' | 'error'
  phase:
    | 'validating'
    | 'creating'
    | 'workspaces'
    | 'refreshing'
    | 'finalizing'
    | 'complete'
  label: string
  step: number
  totalSteps: number
  percent: number
  accountTotal: number
  accounts: AccountRefreshProgress[]
  startedAt: string
  updatedAt: string
  error: string | null
}

export interface RiskControlCheckResult {
  account: Account
  blocked: boolean
  upstreamStatus: number
  errorType: string | null
  message: string | null
}

export type BulkAccountAction = 'refresh' | 'risk-control-check' | 'enable' | 'disable'

export interface BulkAccountActionResult {
  action: BulkAccountAction
  processed: number
  skipped: number
  blocked: number
  accounts: Account[]
}

export type AccountBatchAction = BulkAccountAction | 'delete'

export interface AccountBatchProgress {
  completed: number
  total: number
  succeeded: number
  failed: number
  skipped: number
  active: AccountRefreshProgress[]
}

export interface AccountBatchResult extends AccountBatchProgress {
  processed: number
  blocked: number
  accounts: Account[]
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

  async function addAccounts(
    payload: { name?: string; auth_cookie_values: string },
    onProgress?: (progress: AccountImportProgress) => void
  ) {
    const operationId = globalThis.crypto?.randomUUID?.() ||
      `import-${Date.now()}-${Math.random().toString(36).slice(2)}`
    let polling = Boolean(onProgress)

    async function pollProgress() {
      while (polling) {
        try {
          const result = await requestFetch<{ progress: AccountImportProgress | null }>(
            `/api/accounts/import-progress?operationId=${encodeURIComponent(operationId)}`,
            { signal: AbortSignal.timeout(5_000) }
          )
          if (result.progress) onProgress?.(result.progress)
        } catch {
          // The import request remains authoritative if a progress poll is interrupted.
        }
        if (polling) await new Promise(resolve => setTimeout(resolve, 400))
      }
    }

    const importRequest = requestFetch<{
      created: number
      synchronized: number
      failed: number
      accounts: Account[]
    }>('/api/accounts/batch', {
      method: 'POST',
      body: { ...payload, operation_id: operationId }
    })
    const progressPolling = onProgress ? pollProgress() : Promise.resolve()

    try {
      const result = await importRequest
      const createdIds = new Set(result.accounts.map(account => account.id))
      accounts.value = [
        ...result.accounts,
        ...accounts.value.filter(account => !createdIds.has(account.id))
      ].sort((a, b) => b.id - a.id)
      void Promise.allSettled([fetchAccounts(), fetchStats()])
      return result
    } finally {
      polling = false
      await progressPolling
    }
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

  async function removeAccounts(ids: number[]) {
    const result = await requestFetch<{ ok: boolean; deleted: number }>('/api/accounts/bulk', {
      method: 'DELETE',
      body: { ids }
    })
    await Promise.all([fetchAccounts(), fetchStats()])
    return result
  }

  async function removeNonMembers() {
    const result = await requestFetch<{ ok: boolean; deleted: number }>('/api/accounts/non-members', {
      method: 'DELETE'
    })
    await Promise.all([fetchAccounts(), fetchStats()])
    return result
  }

  async function refreshAccount(
    id: number,
    onProgress?: (progress: AccountRefreshProgress) => void,
    refreshLists = true
  ) {
    let polling = Boolean(onProgress)

    async function pollProgress() {
      while (polling) {
        try {
          const result = await requestFetch<{ progress: AccountRefreshProgress | null }>(
            `/api/accounts/${id}/refresh-progress`,
            { signal: AbortSignal.timeout(5_000) }
          )
          if (result.progress) {
            onProgress?.(result.progress)
          }
        } catch {
          // The refresh request remains authoritative if a progress poll is interrupted.
        }
        if (polling) await new Promise(resolve => setTimeout(resolve, 400))
      }
    }

    const refreshRequest = requestFetch<Account>(
      `/api/accounts/${id}/refresh`,
      { method: 'POST' }
    )
    const progressPolling = onProgress ? pollProgress() : Promise.resolve()

    try {
      const account = await refreshRequest
      if (refreshLists) await Promise.all([fetchAccounts(), fetchStats()])
      return account
    } finally {
      polling = false
      await progressPolling
    }
  }

  async function fetchReferralRewards(id: number) {
    return requestFetch<ReferralRewardList>(`/api/accounts/${id}/referral-rewards`)
  }

  async function useReferralReward(id: number, rewardId: string) {
    const result = await requestFetch<{
      account: Account
      rewardId: string
      rewardIds: string[]
      usedRewardIds: string[]
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

  async function runBulkAccountAction(ids: number[], action: BulkAccountAction) {
    const result = await requestFetch<BulkAccountActionResult>('/api/accounts/bulk', {
      method: 'POST',
      body: { ids, action }
    })
    await Promise.all([fetchAccounts(), fetchStats()])
    return result
  }

  async function runAccountBatch(
    ids: number[],
    action: AccountBatchAction,
    onProgress?: (progress: AccountBatchProgress) => void
  ): Promise<AccountBatchResult> {
    const uniqueIds = [...new Set(ids)]
    const accountById = new Map(accounts.value.map(account => [account.id, account]))
    const requestedAccounts = uniqueIds
      .map(id => accountById.get(id))
      .filter((account): account is Account => Boolean(account))
    const eligibleAccounts = requestedAccounts.filter((account) => {
      if (action === 'risk-control-check') return account.has_upstream_api_key
      if (action === 'enable') return account.status === 'disabled'
      if (action === 'disable') return account.status !== 'disabled'
      return true
    })

    const progress: AccountBatchProgress = {
      completed: 0,
      total: eligibleAccounts.length,
      succeeded: 0,
      failed: 0,
      skipped: uniqueIds.length - eligibleAccounts.length,
      active: []
    }
    const activeProgress = new Map<number, AccountRefreshProgress>()
    const updatedAccounts: Account[] = []
    let blocked = 0
    let cursor = 0
    const emitProgress = () => {
      progress.active = [...activeProgress.values()]
      onProgress?.({ ...progress, active: [...progress.active] })
    }
    emitProgress()

    async function execute(account: Account) {
      if (action === 'delete') {
        await requestFetch(`/api/accounts/${account.id}`, { method: 'DELETE' })
        return
      }
      if (action === 'risk-control-check') {
        const result = await requestFetch<RiskControlCheckResult>(
          `/api/accounts/${account.id}/risk-control-check`,
          { method: 'POST' }
        )
        updatedAccounts.push(result.account)
        if (result.blocked) blocked++
        return
      }
      if (action === 'disable') {
        const updated = await requestFetch<Account>(`/api/accounts/${account.id}`, {
          method: 'PATCH',
          body: { status: 'disabled' }
        })
        updatedAccounts.push(updated)
        return
      }
      if (action === 'enable') {
        await requestFetch<Account>(`/api/accounts/${account.id}`, {
          method: 'PATCH',
          body: { status: 'pending' }
        })
      }
      const updated = await refreshAccount(
        account.id,
        accountProgress => {
          activeProgress.set(account.id, accountProgress)
          emitProgress()
        },
        false
      )
      updatedAccounts.push(updated)
      if (updated.status === 'error') throw new Error(updated.last_error || 'Account refresh failed')
    }

    async function worker() {
      while (cursor < eligibleAccounts.length) {
        const account = eligibleAccounts[cursor++]!
        try {
          await execute(account)
          progress.succeeded++
        } catch {
          progress.failed++
        } finally {
          activeProgress.delete(account.id)
          progress.completed++
          emitProgress()
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(4, eligibleAccounts.length) }, worker)
    )
    await Promise.all([fetchAccounts(), fetchStats()])
    return {
      ...progress,
      processed: progress.completed,
      blocked,
      accounts: updatedAccounts
    }
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
    removeAccounts,
    removeNonMembers,
    refreshAccount,
    fetchReferralRewards,
    useReferralReward,
    cancelRenewal,
    refreshAll,
    checkRiskControl,
    checkAllRiskControls,
    runBulkAccountAction,
    runAccountBatch
  }
}
