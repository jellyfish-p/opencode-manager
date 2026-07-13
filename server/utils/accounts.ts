import type { Account, AccountStatus } from './db'

const accountRefreshes = new Map<number, Promise<Account>>()

function quotaFromInfo(info: Awaited<ReturnType<typeof fetchOpenCodeAccount>>, now: Date) {
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
  return { rollingResetAt, weeklyResetAt, monthlyResetAt, quota }
}

export function refreshAccount(id: number): Promise<Account> {
  const pending = accountRefreshes.get(id)
  if (pending) return pending

  const refresh = refreshAccountOnce(id).finally(() => {
    if (accountRefreshes.get(id) === refresh) accountRefreshes.delete(id)
  })
  accountRefreshes.set(id, refresh)
  return refresh
}

async function refreshAccountOnce(id: number): Promise<Account> {
  const account = getAccount(id)
  if (!account) {
    throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  }

  try {
    let info = await fetchOpenCodeAccount(account.auth_cookie, account.workspace_id)
    let referralError: string | null = null
    const attemptedRewards = new Set<string>()

    while (
      account.disabled_reason !== 'manual' &&
      info.subscriptionStatus === 'active' &&
      attemptedRewards.size < 20
    ) {
      const currentQuota = quotaFromInfo(info, new Date()).quota
      if (!currentQuota.exhausted.length) break

      const referralId = info.availableReferralRewardIds.find(id => !attemptedRewards.has(id))
      if (!referralId) break
      if (!info.workspaceId || !info.referralApplyServerId) {
        referralError = 'Available referral reward found, but the apply action could not be resolved'
        break
      }

      attemptedRewards.add(referralId)
      try {
        await applyOpenCodeReferralReward(
          account.auth_cookie,
          info.workspaceId,
          referralId,
          info.referralApplyServerId
        )
      } catch (error) {
        const latest = await fetchOpenCodeAccount(account.auth_cookie, info.workspaceId)
        if (latest.availableReferralRewardIds.includes(referralId)) throw error
        // Another process applied the same reward after this refresh began.
        info = latest
      }

      const appliedAt = new Date().toISOString()
      updateAccount(id, {
        last_referral_reward_id: referralId,
        last_referral_reward_applied_at: appliedAt
      })
      info = await fetchOpenCodeAccount(account.auth_cookie, info.workspaceId)
    }

    const workspaceId = info.workspaceId || account.workspace_id
    const subscriptionUpdate: Partial<Account> = {}
    if (info.subscriptionStatus === 'active' && info.liteSubscriptionId && workspaceId) {
      const checkedAt = account.subscription_cancel_checked_at
        ? new Date(account.subscription_cancel_checked_at).getTime()
        : 0
      const checkExpired = !Number.isFinite(checkedAt) || Date.now() - checkedAt >= 24 * 60 * 60 * 1000
      const shouldCheck =
        account.cancelled_subscription_id !== info.liteSubscriptionId ||
        !account.subscription_cancelled_at ||
        checkExpired

      if (shouldCheck) {
        if (!info.billingPortalServerId) {
          subscriptionUpdate.subscription_cancel_error =
            'Active subscription found, but the billing portal action could not be resolved'
        } else {
          try {
            const cancellation = await cancelOpenCodeSubscriptionRenewal(
              account.auth_cookie,
              workspaceId,
              info.liteSubscriptionId,
              info.billingPortalServerId
            )
            const cancelledAt = new Date().toISOString()
            subscriptionUpdate.cancelled_subscription_id = info.liteSubscriptionId
            subscriptionUpdate.subscription_cancelled_at =
              cancellation.alreadyCancelled &&
              account.cancelled_subscription_id === info.liteSubscriptionId &&
              account.subscription_cancelled_at
                ? account.subscription_cancelled_at
                : cancelledAt
            subscriptionUpdate.subscription_cancel_checked_at = cancelledAt
            subscriptionUpdate.subscription_ends_at = cancellation.currentPeriodEnd
            subscriptionUpdate.subscription_cancel_error = null
          } catch (error) {
            subscriptionUpdate.subscription_cancel_error =
              error instanceof Error ? error.message : String(error)
          }
        }
      }
    }

    let upstreamApiKey = account.upstream_api_key
    if (workspaceId) {
      try {
        upstreamApiKey = await fetchOpenCodeApiKey(account.auth_cookie, workspaceId) || upstreamApiKey
      } catch {
        // Quota and membership refresh must still succeed if the keys page is temporarily unavailable.
      }
    }
    const now = new Date()
    const { rollingResetAt, weeklyResetAt, monthlyResetAt, quota } = quotaFromInfo(info, now)
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
      ...subscriptionUpdate,
      upstream_api_key: upstreamApiKey,
      status,
      disabled_reason: disabledReason,
      auto_enable_at: disabledReason?.startsWith('quota:') ? quota.autoEnableAt : null,
      last_error: referralError,
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
