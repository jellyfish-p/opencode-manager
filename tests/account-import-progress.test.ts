import { afterEach, expect, test } from 'bun:test'
import {
  beginAccountImportProgress,
  clearAccountImportProgress,
  getAccountImportProgress
} from '../server/utils/account-import-progress'
import {
  beginAccountRefreshProgress,
  clearAccountRefreshProgress
} from '../server/utils/account-refresh-progress'

afterEach(() => {
  clearAccountImportProgress()
  clearAccountRefreshProgress()
})

test('exposes workspace discovery before the add request completes', () => {
  const reporter = beginAccountImportProgress('import-test-1')
  reporter.update('workspaces', '正在发现 workspace')

  expect(getAccountImportProgress('import-test-1')).toMatchObject({
    operationId: 'import-test-1',
    status: 'running',
    phase: 'workspaces',
    label: '正在发现 workspace',
    step: 2
  })
})

test('includes per-account refresh phases during account import', () => {
  const reporter = beginAccountImportProgress('import-test-2')
  reporter.setAccountIds([42])
  reporter.update('refreshing', '正在同步 workspace 账号')

  const accountReporter = beginAccountRefreshProgress(42)
  accountReporter.update('subscription', '正在检查订阅')

  expect(getAccountImportProgress('import-test-2')).toMatchObject({
    phase: 'refreshing',
    accountTotal: 1,
    accounts: [
      {
        accountId: 42,
        phase: 'subscription',
        label: '正在检查订阅'
      }
    ]
  })
})
