import { beforeEach, describe, expect, test } from 'bun:test'
import {
  cacheAvailableReferralRewards,
  consumeCachedReferralReward,
  getCachedReferralRewards,
  removeCachedReferralRewards,
  selectCachedReferralReward,
  retainCachedReferralRewardAccounts
} from '../server/utils/referral-reward-cache'

describe('referral reward memory cache', () => {
  beforeEach(() => {
    removeCachedReferralRewards(1)
    removeCachedReferralRewards(2)
  })

  test('replaces and deduplicates available rewards on refresh', () => {
    cacheAvailableReferralRewards(1, {
      rewardIds: ['ref_A', 'ref_A', 'ref_B'],
      usedRewardIds: ['ref_USED', 'ref_USED'],
      workspaceId: 'wrk_TEST',
      applyServerId: 'server-action',
      refreshedAt: 123
    })

    expect(getCachedReferralRewards(1)).toEqual({
      rewardIds: ['ref_A', 'ref_B'],
      usedRewardIds: ['ref_USED'],
      workspaceId: 'wrk_TEST',
      applyServerId: 'server-action',
      refreshedAt: 123
    })

    cacheAvailableReferralRewards(1, {
      rewardIds: [],
      workspaceId: 'wrk_TEST',
      applyServerId: null,
      refreshedAt: 456
    })
    expect(getCachedReferralRewards(1)?.rewardIds).toEqual([])
    expect(getCachedReferralRewards(1)?.refreshedAt).toBe(456)
  })

  test('consumes rewards and prunes deleted accounts', () => {
    cacheAvailableReferralRewards(1, {
      rewardIds: ['ref_A', 'ref_B'],
      workspaceId: 'wrk_ONE',
      applyServerId: 'action-one'
    })
    cacheAvailableReferralRewards(2, {
      rewardIds: ['ref_C'],
      workspaceId: 'wrk_TWO',
      applyServerId: 'action-two'
    })

    expect(consumeCachedReferralReward(1, 'ref_A')).toBe(true)
    expect(getCachedReferralRewards(1)?.rewardIds).toEqual(['ref_B'])
    expect(getCachedReferralRewards(1)?.usedRewardIds).toEqual(['ref_A'])

    retainCachedReferralRewardAccounts([1])
    expect(getCachedReferralRewards(1)).toBeDefined()
    expect(getCachedReferralRewards(2)).toBeUndefined()
  })

  test('selects the exact available reward requested by the user', () => {
    cacheAvailableReferralRewards(1, {
      rewardIds: ['ref_A', 'ref_B'],
      workspaceId: 'wrk_ONE',
      applyServerId: 'action-one',
      refreshedAt: 123
    })

    expect(selectCachedReferralReward(1, 'ref_B')).toEqual({
      rewardId: 'ref_B',
      workspaceId: 'wrk_ONE',
      applyServerId: 'action-one',
      refreshedAt: 123
    })
    expect(selectCachedReferralReward(1, 'ref_MISSING')).toBeUndefined()
  })
})
