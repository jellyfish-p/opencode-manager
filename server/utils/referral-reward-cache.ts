export interface ReferralRewardCacheInput {
  rewardIds: Iterable<string>
  usedRewardIds?: Iterable<string>
  workspaceId: string | null
  applyServerId: string | null
  refreshedAt?: number
}

export interface ReferralRewardCacheSnapshot {
  rewardIds: string[]
  usedRewardIds: string[]
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
  usedRewardIds: Set<string>
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
    usedRewardIds: new Set(input.usedRewardIds ?? []),
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
    usedRewardIds: [...cached.usedRewardIds],
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
  const cached = referralRewardsByAccount.get(accountId)
  if (!cached?.rewardIds.delete(rewardId)) return false
  cached.usedRewardIds.add(rewardId)
  return true
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
