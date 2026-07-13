import type { Account } from './db'

export async function refreshAccount(id: number): Promise<Account> {
  const account = getAccount(id)
  if (!account) {
    throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  }

  try {
    const info = await fetchOpenCodeAccount(account.auth_cookie, account.workspace_id)
    return updateAccount(id, {
      email: info.email,
      workspace_id: info.workspaceId,
      workspace_name: info.workspaceName,
      balance: info.balance,
      rolling_usage: info.rollingUsage,
      rolling_reset_sec: info.rollingResetSec,
      weekly_usage: info.weeklyUsage,
      weekly_reset_sec: info.weeklyResetSec,
      monthly_usage: info.monthlyUsage,
      monthly_reset_sec: info.monthlyResetSec,
      referral_code: info.referralCode,
      subscription_status: info.subscriptionStatus,
      status: 'active',
      last_error: null,
      last_synced_at: new Date().toISOString()
    })!
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return updateAccount(id, {
      status: 'error',
      last_error: message,
      last_synced_at: new Date().toISOString()
    })!
  }
}

export async function refreshAllAccounts() {
  const accounts = listAccounts().filter(a => a.status !== 'disabled')
  const results = []
  for (const account of accounts) {
    results.push(await refreshAccount(account.id))
  }
  return results
}
