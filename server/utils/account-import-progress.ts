import {
  getAccountRefreshProgress,
  type AccountRefreshProgress
} from './account-refresh-progress'

export type AccountImportPhase =
  | 'validating'
  | 'creating'
  | 'workspaces'
  | 'refreshing'
  | 'finalizing'
  | 'complete'

export type AccountImportProgressStatus = 'running' | 'complete' | 'error'

export interface AccountImportProgress {
  operationId: string
  status: AccountImportProgressStatus
  phase: AccountImportPhase
  label: string
  step: number
  totalSteps: number
  percent: number
  accountTotal: number
  accounts: AccountRefreshProgress[]
  startedAt: string
  updatedAt: string
  error: string | null
}

export interface AccountImportProgressReporter {
  update(phase: Exclude<AccountImportPhase, 'validating' | 'complete'>, label: string): void
  setAccountIds(ids: number[]): void
  complete(): void
  fail(error: string): void
}

const TOTAL_STEPS = 5
const COMPLETED_TTL_MS = 30 * 60 * 1000
const PHASE_STEPS: Record<AccountImportPhase, number> = {
  validating: 0,
  creating: 1,
  workspaces: 2,
  refreshing: 3,
  finalizing: 4,
  complete: TOTAL_STEPS
}

interface ImportProgressEntry {
  token: symbol
  accountIds: number[]
  snapshot: Omit<AccountImportProgress, 'accounts'>
}

const progressByOperation = new Map<string, ImportProgressEntry>()

function removeExpiredProgress() {
  const now = Date.now()
  for (const [operationId, entry] of progressByOperation) {
    if (
      entry.snapshot.status !== 'running' &&
      now - Date.parse(entry.snapshot.updatedAt) >= COMPLETED_TTL_MS
    ) {
      progressByOperation.delete(operationId)
    }
  }
}

function updateEntry(
  operationId: string,
  token: symbol,
  update: (entry: ImportProgressEntry) => void
) {
  const entry = progressByOperation.get(operationId)
  if (!entry || entry.token !== token) return
  update(entry)
  entry.snapshot.updatedAt = new Date().toISOString()
}

export function beginAccountImportProgress(
  operationId: string
): AccountImportProgressReporter {
  removeExpiredProgress()
  const token = Symbol(`account-import-${operationId}`)
  const now = new Date().toISOString()
  progressByOperation.set(operationId, {
    token,
    accountIds: [],
    snapshot: {
      operationId,
      status: 'running',
      phase: 'validating',
      label: '正在校验 Cookie',
      step: 0,
      totalSteps: TOTAL_STEPS,
      percent: 0,
      accountTotal: 0,
      startedAt: now,
      updatedAt: now,
      error: null
    }
  })

  return {
    update(phase, label) {
      updateEntry(operationId, token, entry => {
        const step = PHASE_STEPS[phase]
        entry.snapshot.status = 'running'
        entry.snapshot.phase = phase
        entry.snapshot.label = label
        entry.snapshot.step = step
        entry.snapshot.percent = Math.round((step / TOTAL_STEPS) * 100)
        entry.snapshot.error = null
      })
    },
    setAccountIds(ids) {
      updateEntry(operationId, token, entry => {
        entry.accountIds = [...new Set(ids)]
        entry.snapshot.accountTotal = entry.accountIds.length
      })
    },
    complete() {
      updateEntry(operationId, token, entry => {
        entry.snapshot.status = 'complete'
        entry.snapshot.phase = 'complete'
        entry.snapshot.label = '账号添加完成'
        entry.snapshot.step = TOTAL_STEPS
        entry.snapshot.percent = 100
        entry.snapshot.error = null
      })
    },
    fail(error) {
      updateEntry(operationId, token, entry => {
        entry.snapshot.status = 'error'
        entry.snapshot.error = error
      })
    }
  }
}

export function getAccountImportProgress(
  operationId: string
): AccountImportProgress | null {
  removeExpiredProgress()
  const entry = progressByOperation.get(operationId)
  if (!entry) return null
  return {
    ...entry.snapshot,
    accounts: entry.accountIds
      .map(getAccountRefreshProgress)
      .filter((progress): progress is AccountRefreshProgress => Boolean(progress))
  }
}

export function clearAccountImportProgress(operationId?: string) {
  if (operationId === undefined) {
    progressByOperation.clear()
    return
  }
  progressByOperation.delete(operationId)
}
