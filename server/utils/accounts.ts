import type { Account, AccountStatus } from './db'
import { resolveRefreshedAccountEmail } from './account-identity'
import { AccountOperationQueue } from './account-operation-queue'
import { AccountPollSchedule } from './account-polling'
import { validateAuthCookieValue } from './auth-cookie'
import type { OpenCodeAccountInfo } from './opencode'
import { createAccountFetch } from './account-fetch'
import { ensureAccountIpAssignment } from './ip-pool'
import {
  inspectRiskControlResponse,
  isProtectedAccountDisabledReason,
  RISK_CONTROL_DISABLED_REASON
} from './account-risk-control'
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
const RISK_CONTROL_CHECK_MODEL = process.env.RISK_CONTROL_CHECK_MODEL || 'glm-5.2'

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
    const nextAuthCookie = body.auth_cookie === undefined
      ? undefined
      : validateAuthCookieValue(body.auth_cookie)
    const credentialChanged = nextAuthCookie !== undefined && nextAuthCookie !== account.auth_cookie

    const updated = updateAccount(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(nextAuthCookie !== undefined ? { auth_cookie: nextAuthCookie } : {}),
      ...(credentialChanged
        ? {
            email: null,
            workspace_id: null,
            workspace_name: null,
            upstream_api_key: null,
            referral_code: null,
            risk_control_checked_at: null,
            risk_control_detected_at: null,
            ...(account.disabled_reason === RISK_CONTROL_DISABLED_REASON
              ? {
                  status: 'pending' as AccountStatus,
                  disabled_reason: null,
                  auto_enable_at: null,
                  last_error: null
                }
              : {})
          }
        : {}),
      ...(body.status !== undefined
        ? body.status === 'disabled'
          ? { status: body.status, disabled_reason: 'manual', auto_enable_at: null }
          : { status: body.status, disabled_reason: null, auto_enable_at: null }
        : {})
    })!
    if (credentialChanged) {
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

async function expandAccountWorkspaces(id: number): Promise<Account[]> {
  const account = ensureAccountIpAssignment(id)
  if (!account) return []

  try {
    const infos = await fetchOpenCodeAccounts(
      account.auth_cookie,
      account.workspace_id,
      createAccountFetch(account)
    )
    const workspaceInfos = infos.filter(
      (info): info is OpenCodeAccountInfo & { workspaceId: string } => Boolean(info.workspaceId)
    )
    if (!workspaceInfos.length) return [account]

    const primary = workspaceInfos[0]!
    const additional = workspaceInfos.slice(1)
    const expanded = [
      updateAccount(account.id, {
        workspace_id: primary.workspaceId,
        workspace_name: primary.workspaceName
      })!
    ]

    for (const info of additional) {
      const created = createAccount({
        name: account.name || undefined,
        auth_cookie: account.auth_cookie
      })
      expanded.push(updateAccount(created.id, {
        workspace_id: info.workspaceId,
        workspace_name: info.workspaceName
      })!)
    }
    return expanded
  } catch {
    // Keep the original pending account so the normal refresh path records the upstream error.
    return [account]
  }
}

export async function expandAccountWorkspacesByIds(ids: number[]) {
  const expanded = await mapConcurrent(ids, REFRESH_CONCURRENCY, expandAccountWorkspaces)
  ensureStableIpAssignments()
  return expanded.flat().map(account => getAccount(account.id) || account)
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
    usedRewardIds: info.usedReferralRewardIds,
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
  const account = ensureAccountIpAssignment(id)
  if (!account) {
    throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  }
  const fetchImpl = createAccountFetch(account)

  try {
    let info = await fetchOpenCodeAccount(account.auth_cookie, account.workspace_id, fetchImpl)
    cacheReferralRewards(id, info)
    let referralError: string | null = null
    const attemptedRewards = new Set<string>()

    while (
      !options.skipReferralRewards &&
      !isProtectedAccountDisabledReason(account.disabled_reason) &&
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
          info.referralApplyServerId,
          fetchImpl
        )
        consumeCachedReferralReward(id, referralId)
      } catch (error) {
        const latest = await fetchOpenCodeAccount(account.auth_cookie, info.workspaceId, fetchImpl)
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
      info = await fetchOpenCodeAccount(account.auth_cookie, info.workspaceId, fetchImpl)
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
              info.billingPortalServerId,
              fetchImpl
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
    if (workspaceId && !upstreamApiKey) {
      try {
        upstreamApiKey = await fetchOpenCodeApiKey(account.auth_cookie, workspaceId, fetchImpl) || upstreamApiKey
      } catch {
        // Quota and membership refresh must still succeed if the keys page is temporarily unavailable.
      }
    }
    const now = new Date()
    const { rollingResetAt, weeklyResetAt, monthlyResetAt, quota } = quotaFromInfo(info, now)
    const isMember = info.subscriptionStatus === 'active'
    const currentAccount = getAccount(id) || account
    const protectedDisabledReason = currentAccount.status === 'disabled' &&
      isProtectedAccountDisabledReason(currentAccount.disabled_reason)
      ? currentAccount.disabled_reason
      : null
    const status: AccountStatus = protectedDisabledReason
      ? 'disabled'
      : !isMember || quota.exhausted.length
        ? 'disabled'
        : 'active'
    const disabledReason = protectedDisabledReason
      ? protectedDisabledReason
      : !isMember
        ? 'expired'
        : quota.exhausted.length
          ? `quota:${quota.exhausted.join(',')}`
          : null
    return updateAccount(id, {
      email: resolveRefreshedAccountEmail(info.email, account.email),
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
      last_error: protectedDisabledReason === RISK_CONTROL_DISABLED_REASON
        ? currentAccount.last_error
        : referralError,
      last_synced_at: now.toISOString()
    })!
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const currentAccount = getAccount(id) || account
    const preserveDisabled = currentAccount.status === 'disabled' &&
      isProtectedAccountDisabledReason(currentAccount.disabled_reason)
    const failedAccount = updateAccount(id, {
      status: preserveDisabled ? 'disabled' : 'error',
      last_error: currentAccount.disabled_reason === RISK_CONTROL_DISABLED_REASON
        ? currentAccount.last_error || message
        : message,
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

export function refreshAccountsByIds(ids: number[]) {
  return mapConcurrent(ids, REFRESH_CONCURRENCY, refreshAccount)
}

export interface RiskControlCheckResult {
  account: Account
  blocked: boolean
  upstreamStatus: number
  errorType: string | null
  message: string | null
}

export function markAccountRiskControlled(id: number, message: string | null): Account | undefined {
  const account = getAccount(id)
  if (!account) return undefined

  const now = new Date().toISOString()
  const updated = updateAccount(id, {
    status: 'disabled',
    disabled_reason: RISK_CONTROL_DISABLED_REASON,
    auto_enable_at: null,
    risk_control_checked_at: now,
    risk_control_detected_at: account.disabled_reason === RISK_CONTROL_DISABLED_REASON
      ? account.risk_control_detected_at || now
      : now,
    last_error: message || 'Request blocked by upstream provider.'
  })!
  updateAccountPollSchedule(updated)
  return updated
}

export function checkAccountRiskControl(id: number): Promise<RiskControlCheckResult> {
  return accountOperations.run(id, async () => {
    const account = ensureAccountIpAssignment(id)
    if (!account) {
      throw createError({ statusCode: 404, statusMessage: 'Account not found' })
    }
    if (!account.upstream_api_key) {
      throw createError({ statusCode: 409, statusMessage: 'Account does not have an upstream API key' })
    }

    const fetchImpl = createAccountFetch(account)
    const response = await fetchImpl('https://opencode.ai/zen/go/v1/chat/completions', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${account.upstream_api_key}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: RISK_CONTROL_CHECK_MODEL,
        messages: [{ role: 'user', content: 'Reply OK' }],
        max_tokens: 1,
        stream: false
      }),
      signal: AbortSignal.timeout(60_000)
    })
    const inspection = await inspectRiskControlResponse(response)
    await response.body?.cancel().catch(() => {})
    const checkedAt = new Date().toISOString()

    let updated: Account
    if (inspection.blocked) {
      updated = markAccountRiskControlled(id, inspection.message)!
    } else if (response.ok && account.disabled_reason === RISK_CONTROL_DISABLED_REASON) {
      updated = updateAccount(id, {
        status: 'active',
        disabled_reason: null,
        auto_enable_at: null,
        risk_control_checked_at: checkedAt,
        last_error: null
      })!
      updateAccountPollSchedule(updated)
    } else {
      updated = updateAccount(id, { risk_control_checked_at: checkedAt })!
      updateAccountPollSchedule(updated)
    }

    return {
      account: updated,
      blocked: inspection.blocked,
      upstreamStatus: response.status,
      errorType: inspection.errorType,
      message: inspection.message
    }
  })
}

export function checkAccountRiskControlsByIds(ids: number[]) {
  return mapConcurrent(ids, REFRESH_CONCURRENCY, checkAccountRiskControl)
}

export async function checkAllAccountRiskControls() {
  const accounts = listAccounts().filter(account =>
    Boolean(account.upstream_api_key) &&
    account.disabled_reason !== 'manual' &&
    (account.status === 'active' || account.disabled_reason === RISK_CONTROL_DISABLED_REASON)
  )
  return mapConcurrent(accounts, REFRESH_CONCURRENCY, account => checkAccountRiskControl(account.id))
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
  const account = ensureAccountIpAssignment(id)
  if (!account) {
    throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  }
  const fetchImpl = createAccountFetch(account)

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
    selected.applyServerId,
    fetchImpl
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
    usedRewardIds: getCachedReferralRewards(id)?.usedRewardIds ?? [],
    refreshed
  }
}

export async function cancelAccountRenewal(id: number) {
  const account = ensureAccountIpAssignment(id)
  if (!account) {
    throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  }
  const fetchImpl = createAccountFetch(account)

  const info = await fetchOpenCodeAccount(account.auth_cookie, account.workspace_id, fetchImpl)
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
    info.billingPortalServerId,
    fetchImpl
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
