import { describe, expect, test } from 'bun:test'
import { AccountOperationQueue } from '../server/utils/account-operation-queue'
import {
  cacheAvailableReferralRewards,
  removeCachedReferralRewards,
  selectCachedReferralReward
} from '../server/utils/referral-reward-cache'

describe('account operation queue', () => {
  test('serializes operations for the same account', async () => {
    const queue = new AccountOperationQueue()
    const events: string[] = []
    let releaseFirst!: () => void
    const firstBlocked = new Promise<void>(resolve => {
      releaseFirst = resolve
    })

    const first = queue.run(1, async () => {
      events.push('first:start')
      await firstBlocked
      events.push('first:end')
    })
    const second = queue.run(1, async () => {
      events.push('second:start')
    })

    await Promise.resolve()
    expect(events).toEqual(['first:start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual(['first:start', 'first:end', 'second:start'])
  })

  test('continues after an earlier operation fails', async () => {
    const queue = new AccountOperationQueue()
    const first = queue.run(1, async () => {
      throw new Error('failed')
    })
    const second = queue.run(1, async () => 'completed')

    await expect(first).rejects.toThrow('failed')
    await expect(second).resolves.toBe('completed')
  })

  test('credential invalidation runs after an old refresh and before later reward selection', async () => {
    const accountId = 99
    const queue = new AccountOperationQueue()
    let releaseRefresh!: () => void
    const refreshBlocked = new Promise<void>(resolve => {
      releaseRefresh = resolve
    })

    const oldCredentialRefresh = queue.run(accountId, async () => {
      await refreshBlocked
      cacheAvailableReferralRewards(accountId, {
        rewardIds: ['ref_OLD'],
        workspaceId: 'wrk_OLD',
        applyServerId: 'action-old'
      })
    })
    const credentialUpdate = queue.run(accountId, async () => {
      removeCachedReferralRewards(accountId)
    })
    const laterSelection = queue.run(accountId, async () =>
      selectCachedReferralReward(accountId, 'ref_OLD')
    )

    releaseRefresh()
    await Promise.all([oldCredentialRefresh, credentialUpdate])
    expect(await laterSelection).toBeUndefined()
  })
})
