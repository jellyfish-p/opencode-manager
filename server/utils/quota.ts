export const QUOTA_LIMITS_USD = {
  rolling: 12,
  weekly: 30,
  monthly: 60
} as const

export type QuotaWindow = keyof typeof QUOTA_LIMITS_USD

export interface QuotaSnapshot {
  rollingUsage: number | null
  rollingResetAt: string | null
  weeklyUsage: number | null
  weeklyResetAt: string | null
  monthlyUsage: number | null
  monthlyResetAt: string | null
}

export function resetAtFromSeconds(seconds: number | null, now = new Date()): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null
  return new Date(now.getTime() + Math.max(0, seconds) * 1000).toISOString()
}

export function usedAmount(usagePercent: number | null | undefined, limit: number): number {
  if (typeof usagePercent !== 'number' || !Number.isFinite(usagePercent)) return 0
  return Math.round((Math.max(0, usagePercent) / 100) * limit * 100) / 100
}

export function analyzeQuota(snapshot: QuotaSnapshot) {
  const windows = [
    { name: 'rolling' as const, usage: snapshot.rollingUsage, resetAt: snapshot.rollingResetAt },
    { name: 'weekly' as const, usage: snapshot.weeklyUsage, resetAt: snapshot.weeklyResetAt },
    { name: 'monthly' as const, usage: snapshot.monthlyUsage, resetAt: snapshot.monthlyResetAt }
  ]
  const exhausted = windows.filter(item => typeof item.usage === 'number' && item.usage >= 100)
  const futureResets = windows
    .map(item => item.resetAt)
    .filter((value): value is string => Boolean(value))
    .sort()
  const exhaustedResets = exhausted
    .map(item => item.resetAt)
    .filter((value): value is string => Boolean(value))
    .sort()

  return {
    exhausted: exhausted.map(item => item.name),
    nextRefreshAt: futureResets[0] || null,
    autoEnableAt: exhaustedResets.at(-1) || null
  }
}
