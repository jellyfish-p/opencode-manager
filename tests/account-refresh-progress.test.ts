import { afterEach, expect, test } from 'bun:test'
import {
  beginAccountRefreshProgress,
  clearAccountRefreshProgress,
  getAccountRefreshProgress
} from '../server/utils/account-refresh-progress'

afterEach(() => {
  clearAccountRefreshProgress()
})

test('exposes the last reached phase while an account refresh is still running', () => {
  const reporter = beginAccountRefreshProgress(42)

  expect(getAccountRefreshProgress(42)).toMatchObject({
    accountId: 42,
    status: 'running',
    phase: 'queued',
    step: 0
  })

  reporter.update('workspace', '正在加载 workspace')

  expect(getAccountRefreshProgress(42)).toMatchObject({
    status: 'running',
    phase: 'workspace',
    label: '正在加载 workspace',
    step: 1
  })
})

test('keeps the failing phase visible when refresh fails', () => {
  const reporter = beginAccountRefreshProgress(7)
  reporter.update('subscription', '正在检查订阅')
  reporter.fail('上游请求超时')

  expect(getAccountRefreshProgress(7)).toMatchObject({
    accountId: 7,
    status: 'error',
    phase: 'subscription',
    label: '正在检查订阅',
    error: '上游请求超时'
  })
})
