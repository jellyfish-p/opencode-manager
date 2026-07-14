export interface ReferralRewardCacheInput {
  rewardIds: Iterable<string>
  workspaceId: string | null
  applyServerId: string | null
  refreshedAt?: number
}

export interface ReferralRewardCacheSnapshot {
  rewardIds: string[]
  workspaceId: string | null
  applyServerId: string | null
  refreshedAt: number
}

export interface SelectedReferralReward {
  rewardId: string
  workspaceId: string | null
  applyServerId: string | null
  refreshedAt: number
}

interface ReferralRewardCacheEntry {
  rewardIds: Set<string>
  workspaceId: string | null
  applyServerId: string | null
  refreshedAt: number
}

const referralRewardsByAccount = new Map<number, ReferralRewardCacheEntry>()

export function cacheAvailableReferralRewards(
  accountId: number,
  input: ReferralRewardCacheInput
) {
  referralRewardsByAccount.set(accountId, {
    rewardIds: new Set(input.rewardIds),
    workspaceId: input.workspaceId,
    applyServerId: input.applyServerId,
    refreshedAt: input.refreshedAt ?? Date.now()
  })
}

export function getCachedReferralRewards(
  accountId: number
): ReferralRewardCacheSnapshot | undefined {
  const cached = referralRewardsByAccount.get(accountId)
  if (!cached) return undefined
  return {
    rewardIds: [...cached.rewardIds],
    workspaceId: cached.workspaceId,
    applyServerId: cached.applyServerId,
    refreshedAt: cached.refreshedAt
  }
}

export function selectCachedReferralReward(
  accountId: number,
  rewardId: string
): SelectedReferralReward | undefined {
  const cached = referralRewardsByAccount.get(accountId)
  if (!cached?.rewardIds.has(rewardId)) return undefined
  return {
    rewardId,
    workspaceId: cached.workspaceId,
    applyServerId: cached.applyServerId,
    refreshedAt: cached.refreshedAt
  }
}

export function consumeCachedReferralReward(accountId: number, rewardId: string) {
  return referralRewardsByAccount.get(accountId)?.rewardIds.delete(rewardId) ?? false
}

export function removeCachedReferralRewards(accountId: number) {
  referralRewardsByAccount.delete(accountId)
}

export function retainCachedReferralRewardAccounts(accountIds: Iterable<number>) {
  const retained = new Set(accountIds)
  for (const accountId of referralRewardsByAccount.keys()) {
    if (!retained.has(accountId)) referralRewardsByAccount.delete(accountId)
  }
}
