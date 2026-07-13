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
  referral_code: string | null
  subscription_status: string | null
  status: 'pending' | 'active' | 'error' | 'disabled'
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
  avgRolling: number
  avgWeekly: number
  avgMonthly: number
  totalBalance: number
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

  async function addAccount(payload: { name?: string; auth_cookie: string }) {
    const account = await requestFetch<Account>('/api/accounts', {
      method: 'POST',
      body: payload
    })
    await Promise.all([fetchAccounts(), fetchStats()])
    return account
  }

  async function updateAccount(id: number, payload: Partial<{ name: string; auth_cookie: string; status: Account['status'] }>) {
    const account = await requestFetch<Account>(`/api/accounts/${id}`, {
      method: 'PATCH',
      body: payload
    })
    await Promise.all([fetchAccounts(), fetchStats()])
    return account
  }

  async function removeAccount(id: number) {
    await requestFetch(`/api/accounts/${id}`, { method: 'DELETE' })
    await Promise.all([fetchAccounts(), fetchStats()])
  }

  async function refreshAccount(id: number) {
    const account = await requestFetch<Account>(`/api/accounts/${id}/refresh`, { method: 'POST' })
    await Promise.all([fetchAccounts(), fetchStats()])
    return account
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

  return {
    accounts,
    stats,
    loading,
    fetchAccounts,
    fetchStats,
    addAccount,
    updateAccount,
    removeAccount,
    refreshAccount,
    refreshAll
  }
}
