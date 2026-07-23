export type AccountRefreshPhase =
  | 'queued'
  | 'workspace'
  | 'referral'
  | 'subscription'
  | 'api-key'
  | 'finalizing'
  | 'complete'

export type AccountRefreshProgressStatus = 'running' | 'complete' | 'error'

export interface AccountRefreshProgress {
  accountId: number
  status: AccountRefreshProgressStatus
  phase: AccountRefreshPhase
  label: string
  step: number
  totalSteps: number
  percent: number
  startedAt: string
  updatedAt: string
  error: string | null
}

export interface AccountRefreshProgressReporter {
  update(phase: Exclude<AccountRefreshPhase, 'queued' | 'complete'>, label: string): void
  complete(): void
  fail(error: string): void
}

const TOTAL_STEPS = 6
const PHASE_STEPS: Record<AccountRefreshPhase, number> = {
  queued: 0,
  workspace: 1,
  referral: 2,
  subscription: 3,
  'api-key': 4,
  finalizing: 5,
  complete: TOTAL_STEPS
}

interface ProgressEntry {
  token: symbol
  snapshot: AccountRefreshProgress
}

const progressByAccount = new Map<number, ProgressEntry>()

function cloneProgress(progress: AccountRefreshProgress) {
  return { ...progress }
}

function updateEntry(
  accountId: number,
  token: symbol,
  update: (snapshot: AccountRefreshProgress) => void
) {
  const entry = progressByAccount.get(accountId)
  if (!entry || entry.token !== token) return
  update(entry.snapshot)
  entry.snapshot.updatedAt = new Date().toISOString()
}

export function beginAccountRefreshProgress(
  accountId: number
): AccountRefreshProgressReporter {
  const token = Symbol(`account-refresh-${accountId}`)
  const now = new Date().toISOString()
  progressByAccount.set(accountId, {
    token,
    snapshot: {
      accountId,
      status: 'running',
      phase: 'queued',
      label: '等待刷新任务执行',
      step: 0,
      totalSteps: TOTAL_STEPS,
      percent: 0,
      startedAt: now,
      updatedAt: now,
      error: null
    }
  })

  return {
    update(phase, label) {
      updateEntry(accountId, token, snapshot => {
        const step = PHASE_STEPS[phase]
        snapshot.status = 'running'
        snapshot.phase = phase
        snapshot.label = label
        snapshot.step = step
        snapshot.percent = Math.round((step / TOTAL_STEPS) * 100)
        snapshot.error = null
      })
    },
    complete() {
      updateEntry(accountId, token, snapshot => {
        snapshot.status = 'complete'
        snapshot.phase = 'complete'
        snapshot.label = '刷新完成'
        snapshot.step = TOTAL_STEPS
        snapshot.percent = 100
        snapshot.error = null
      })
    },
    fail(error) {
      updateEntry(accountId, token, snapshot => {
        snapshot.status = 'error'
        snapshot.error = error
      })
    }
  }
}

export function getAccountRefreshProgress(
  accountId: number
): AccountRefreshProgress | null {
  const progress = progressByAccount.get(accountId)?.snapshot
  return progress ? cloneProgress(progress) : null
}

export function clearAccountRefreshProgress(accountId?: number) {
  if (accountId === undefined) {
    progressByAccount.clear()
    return
  }
  progressByAccount.delete(accountId)
}
