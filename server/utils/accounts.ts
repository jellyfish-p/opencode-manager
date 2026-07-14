import type { Account, AccountStatus } from './db'
import { AccountOperationQueue } from './account-operation-queue'
import { AccountPollSchedule } from './account-polling'
import type { OpenCodeAccountInfo } from './opencode'
import {
  cacheAvailableReferralRewards,
  consumeCachedReferralReward,
  getCachedReferralRewards,
  removeCachedReferralRewards,
  selectCachedReferralReward,
  retainCachedReferralRewardAccounts
} from './referral-reward-cache'

const accountRefreshes = new Map<number, Promise<Account>>()
const accountOperations = new AccountOperationQueue()
const accountPollSchedule = new AccountPollSchedule()
let accountPollScheduleHydrated = false
const REFRESH_CONCURRENCY = 4

function ensureAccountPollSchedule(now = Date.now()) {
  if (accountPollScheduleHydrated) return
  accountPollSchedule.hydrate(listAccounts(), now)
  accountPollScheduleHydrated = true
}

export function updateAccountPollSchedule(account: Account) {
  ensureAccountPollSchedule()
  accountPollSchedule.schedule(account)
}

export function removeAccountPollSchedule(id: number) {
  ensureAccountPollSchedule()
  accountPollSchedule.remove(id)
  removeCachedReferralRewards(id)
}

export function rebuildAccountPollSchedule() {
  const accounts = listAccounts()
  accountPollSchedule.hydrate(accounts)
  retainCachedReferralRewardAccounts(accounts.map(account => account.id))
  accountPollScheduleHydrated = true
}

export function updateAccountSettings(
  id: number,
  body: {
    name?: string
    auth_cookie?: string
    status?: AccountStatus
  }
) {
  return accountOperations.run(id, async () => {
    const account = getAccount(id)
    if (!account) {
      throw createError({ statusCode: 404, statusMessage: 'Account not found' })
    }

    const updated = updateAccount(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.auth_cookie !== undefined ? { auth_cookie: body.auth_cookie.trim() } : {}),
      ...(body.status !== undefined
        ? body.status === 'disabled'
          ? { status: body.status, disabled_reason: 'manual', auto_enable_at: null }
          : { status: body.status, disabled_reason: null, auto_enable_at: null }
        : {})
    })!
    if (body.auth_cookie !== undefined && body.auth_cookie.trim() !== account.auth_cookie) {
      removeCachedReferralRewards(id)
    }
    updateAccountPollSchedule(updated)
    return updated
  })
}

async function mapConcurrent<T, R>(items: T[], limit: number, callback: (item: T) => Promise<R>) {
  const results: R[] = []
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await callback(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

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

interface RefreshAccountOptions {
  skipReferralRewards?: boolean
  throwOnError?: boolean
}

function cacheReferralRewards(accountId: number, info: OpenCodeAccountInfo) {
  cacheAvailableReferralRewards(accountId, {
    rewardIds: info.availableReferralRewardIds,
    workspaceId: info.workspaceId,
    applyServerId: info.referralApplyServerId
  })
}

export function refreshAccount(id: number): Promise<Account> {
  const pending = accountRefreshes.get(id)
  if (pending) return pending

  const refresh = accountOperations.run(id, () => refreshAccountOnce(id, {}))
    .then(account => {
      updateAccountPollSchedule(account)
      return account
    })
    .finally(() => {
      if (accountRefreshes.get(id) === refresh) accountRefreshes.delete(id)
    })
  accountRefreshes.set(id, refresh)
  return refresh
}

async function refreshAccountOnce(id: number, options: RefreshAccountOptions): Promise<Account> {
  const account = getAccount(id)
  if (!account) {
    throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  }

  try {
    let info = await fetchOpenCodeAccount(account.auth_cookie, account.workspace_id)
    cacheReferralRewards(id, info)
    let referralError: string | null = null
    const attemptedRewards = new Set<string>()

    while (
      !options.skipReferralRewards &&
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
        consumeCachedReferralReward(id, referralId)
      } catch (error) {
        const latest = await fetchOpenCodeAccount(account.auth_cookie, info.workspaceId)
        cacheReferralRewards(id, latest)
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
      cacheReferralRewards(id, info)
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
    const failedAccount = updateAccount(id, {
      status: account.disabled_reason === 'manual' ? 'disabled' : 'error',
      last_error: message,
      last_synced_at: new Date().toISOString()
    })!
    if (options.throwOnError) throw err
    return failedAccount
  }
}

export async function refreshAllAccounts() {
  const accounts = listAccounts().filter(a => a.disabled_reason !== 'manual')
  return mapConcurrent(accounts, REFRESH_CONCURRENCY, account => refreshAccount(account.id))
}

export async function refreshDueAccounts(now = new Date()) {
  ensureAccountPollSchedule(now.getTime())
  return refreshScheduledAccounts(accountPollSchedule.takeDue('quota', now.getTime()))
}

export async function refreshDueMembershipAccounts(now = new Date()) {
  ensureAccountPollSchedule(now.getTime())
  return refreshScheduledAccounts(accountPollSchedule.takeDue('membership', now.getTime()))
}

async function refreshScheduledAccounts(ids: number[]) {
  const existingIds = ids.filter(id => {
    const account = getAccount(id)
    if (!account) {
      accountPollSchedule.remove(id)
      return false
    }
    if (account.disabled_reason === 'manual') {
      accountPollSchedule.schedule(account)
      return false
    }
    return true
  })
  return mapConcurrent(existingIds, REFRESH_CONCURRENCY, id => refreshAccount(id))
}

export function useAccountReferralReward(id: number, referralId: string) {
  return accountOperations.run(id, () => useAccountReferralRewardOnce(id, referralId))
}

async function useAccountReferralRewardOnce(id: number, referralId: string) {
  const account = getAccount(id)
  if (!account) {
    throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  }

  const cached = getCachedReferralRewards(id)
  if (!cached) {
    throw createError({ statusCode: 409, statusMessage: 'Referral reward cache is unavailable' })
  }
  const selected = selectCachedReferralReward(id, referralId)
  if (!selected) {
    throw createError({ statusCode: 409, statusMessage: 'Selected referral reward is no longer available' })
  }
  if (!selected.workspaceId || !selected.applyServerId) {
    throw createError({ statusCode: 502, statusMessage: 'Referral reward action could not be resolved' })
  }

  await applyOpenCodeReferralReward(
    account.auth_cookie,
    selected.workspaceId,
    selected.rewardId,
    selected.applyServerId
  )
  consumeCachedReferralReward(id, selected.rewardId)
  updateAccount(id, {
    last_referral_reward_id: selected.rewardId,
    last_referral_reward_applied_at: new Date().toISOString(),
    last_error: null
  })

  let refreshed = true
  let refreshedAccount: Account
  try {
    refreshedAccount = await refreshAccountOnce(id, {
      skipReferralRewards: true,
      throwOnError: true
    })
  } catch {
    refreshed = false
    refreshedAccount = getAccount(id)!
  }
  updateAccountPollSchedule(refreshedAccount)
  return {
    account: refreshedAccount,
    rewardId: selected.rewardId,
    rewardIds: getCachedReferralRewards(id)?.rewardIds ?? [],
    refreshed
  }
}

export async function cancelAccountRenewal(id: number) {
  const account = getAccount(id)
  if (!account) {
    throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  }

  const info = await fetchOpenCodeAccount(account.auth_cookie, account.workspace_id)
  if (info.subscriptionStatus !== 'active') {
    throw createError({ statusCode: 409, statusMessage: 'Account does not have an active subscription' })
  }
  if (!info.workspaceId || !info.liteSubscriptionId || !info.billingPortalServerId) {
    throw createError({ statusCode: 502, statusMessage: 'Subscription cancellation action could not be resolved' })
  }

  const cancellation = await cancelOpenCodeSubscriptionRenewal(
    account.auth_cookie,
    info.workspaceId,
    info.liteSubscriptionId,
    info.billingPortalServerId
  )
  const checkedAt = new Date().toISOString()
  updateAccount(id, {
    cancelled_subscription_id: info.liteSubscriptionId,
    subscription_cancelled_at:
      cancellation.alreadyCancelled && account.subscription_cancelled_at
        ? account.subscription_cancelled_at
        : checkedAt,
    subscription_cancel_checked_at: checkedAt,
    subscription_ends_at: cancellation.currentPeriodEnd,
    subscription_cancel_error: null
  })

  return {
    account: await refreshAccount(id),
    alreadyCancelled: cancellation.alreadyCancelled,
    currentPeriodEnd: cancellation.currentPeriodEnd
  }
}
