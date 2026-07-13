import { describe, expect, test } from 'bun:test'
import { analyzeQuota, QUOTA_LIMITS_USD, resetAtFromSeconds, usedAmount } from '../server/utils/quota'

describe('quota accounting', () => {
  test('uses the configured 12/30/60 dollar windows', () => {
    expect(QUOTA_LIMITS_USD).toEqual({ rolling: 12, weekly: 30, monthly: 60 })
    expect(usedAmount(50, QUOTA_LIMITS_USD.rolling)).toBe(6)
    expect(usedAmount(25, QUOTA_LIMITS_USD.weekly)).toBe(7.5)
    expect(usedAmount(10, QUOTA_LIMITS_USD.monthly)).toBe(6)
  })

  test('records absolute reset nodes and chooses the exhausted window release', () => {
    const now = new Date('2026-07-13T00:00:00.000Z')
    const rollingResetAt = resetAtFromSeconds(60, now)
    const weeklyResetAt = resetAtFromSeconds(120, now)
    const monthlyResetAt = resetAtFromSeconds(180, now)
    const quota = analyzeQuota({
      rollingUsage: 100,
      rollingResetAt,
      weeklyUsage: 100,
      weeklyResetAt,
      monthlyUsage: 50,
      monthlyResetAt
    })

    expect(quota.exhausted).toEqual(['rolling', 'weekly'])
    expect(quota.nextRefreshAt).toBe(rollingResetAt)
    expect(quota.autoEnableAt).toBe(weeklyResetAt)
  })
})
