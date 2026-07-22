export const RISK_CONTROL_DISABLED_REASON = 'risk_control'

export interface RiskControlInspection {
  blocked: boolean
  errorType: string | null
  message: string | null
}

export function isProtectedAccountDisabledReason(reason: string | null | undefined) {
  return reason === 'manual' || reason === RISK_CONTROL_DISABLED_REASON
}

export async function inspectRiskControlResponse(
  response: Response
): Promise<RiskControlInspection> {
  if (response.status !== 401) {
    return { blocked: false, errorType: null, message: null }
  }

  const body = await response.clone().json().catch(() => null) as {
    error?: { type?: unknown; message?: unknown }
  } | null
  const errorType = typeof body?.error?.type === 'string' ? body.error.type : null
  const message = typeof body?.error?.message === 'string' ? body.error.message : null
  const blocked = errorType?.toLowerCase() === 'autherror' &&
    message?.toLowerCase().includes('request blocked by upstream provider') === true

  return { blocked, errorType, message }
}
