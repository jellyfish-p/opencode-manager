import { describe, expect, test } from 'bun:test'
import {
  inspectRiskControlResponse,
  isProtectedAccountDisabledReason
} from '../server/utils/account-risk-control'

describe('account risk control', () => {
  test('recognizes the upstream provider AuthError without consuming the response', async () => {
    const body = {
      type: 'error',
      error: {
        type: 'AuthError',
        message: 'Request blocked by upstream provider.'
      }
    }
    const response = Response.json(body, { status: 401 })

    await expect(inspectRiskControlResponse(response)).resolves.toEqual({
      blocked: true,
      errorType: 'AuthError',
      message: 'Request blocked by upstream provider.'
    })
    await expect(response.json()).resolves.toEqual(body)
  })

  test('does not classify unrelated 401 responses as risk control', async () => {
    const response = Response.json({
      error: { type: 'AuthError', message: 'Invalid API key' }
    }, { status: 401 })

    expect((await inspectRiskControlResponse(response)).blocked).toBe(false)
  })

  test('preserves manual and risk-control disabled states during account refresh', () => {
    expect(isProtectedAccountDisabledReason('manual')).toBe(true)
    expect(isProtectedAccountDisabledReason('risk_control')).toBe(true)
    expect(isProtectedAccountDisabledReason('quota:weekly')).toBe(false)
    expect(isProtectedAccountDisabledReason(null)).toBe(false)
  })
})
