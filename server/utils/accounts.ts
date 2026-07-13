import type { Account, AccountStatus } from './db'

export async function refreshAccount(id: number): Promise<Account> {
  const account = getAccount(id)
  if (!account) {
    throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  }

  try {
    const info = await fetchOpenCodeAccount(account.auth_cookie, account.workspace_id)
    const workspaceId = info.workspaceId || account.workspace_id
    let upstreamApiKey = account.upstream_api_key
    if (workspaceId) {
      try {
        upstreamApiKey = await fetchOpenCodeApiKey(account.auth_cookie, workspaceId) || upstreamApiKey
      } catch {
        // Quota and membership refresh must still succeed if the keys page is temporarily unavailable.
      }
    }
    const now = new Date()
    const rollingResetAt = resetAtFromSeconds(info.rollingResetSec, now)
    const weeklyResetAt = resetAtFromSeconds(info.weeklyResetSec, now)
    const monthlyResetAt = resetAtFromSeconds(info.monthlyResetSec, now)
    const quota = analyzeQuota({
      rollingUsage: info.rollingUsage,
      rollingResetAt,
      weeklyUsage: info.weeklyUsage,
      weeklyResetAt,
      monthlyUsage: info.monthlyUsage,
      monthlyResetAt
    })
    const isMember = info.subscriptionStatus === 'active'
    const isManuallyDisabled = account.status === 'disabled' && account.disabled_reason === 'manual'
    const status: AccountStatus = isManuallyDisabled
      ? 'disabled'
      : !isMember || quota.exhausted.length
        ? 'disabled'
        : 'active'
    const disabledReason = isManuallyDisabled
      ? 'manual'
      : !isMember
        ? 'expired'
        : quota.exhausted.length
          ? `quota:${quota.exhausted.join(',')}`
          : null
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
      rolling_reset_at: rollingResetAt,
      weekly_reset_at: weeklyResetAt,
      monthly_reset_at: monthlyResetAt,
      next_quota_refresh_at: quota.nextRefreshAt,
      quota_refreshed_at: now.toISOString(),
      referral_code: info.referralCode,
      subscription_status: info.subscriptionStatus,
      upstream_api_key: upstreamApiKey,
      status,
      disabled_reason: disabledReason,
      auto_enable_at: disabledReason?.startsWith('quota:') ? quota.autoEnableAt : null,
      last_error: null,
      last_synced_at: now.toISOString()
    })!
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return updateAccount(id, {
      status: account.disabled_reason === 'manual' ? 'disabled' : 'error',
      last_error: message,
      last_synced_at: new Date().toISOString()
    })!
  }
}

export async function refreshAllAccounts() {
  const accounts = listAccounts().filter(a => a.disabled_reason !== 'manual')
  const results = []
  for (const account of accounts) {
    results.push(await refreshAccount(account.id))
  }
  return results
}

export async function refreshDueAccounts(now = new Date()) {
  const timestamp = now.toISOString()
  const due = listAccounts().filter(account =>
    (account.next_quota_refresh_at && account.next_quota_refresh_at <= timestamp) ||
    (account.auto_enable_at && account.auto_enable_at <= timestamp)
  )
  const results = []
  for (const account of due) results.push(await refreshAccount(account.id))
  return results
}
