import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export function apiKeyPrefix(key: string): string {
  if (key.length <= 10) return `${key.slice(0, 3)}***`
  return `${key.slice(0, 8)}...${key.slice(-4)}`
}

export function generateApiKey(): string {
  return `sk-ocm-${randomBytes(24).toString('base64url')}`
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function isValidApiKey(key: string): boolean {
  const value = key.trim()
  if (!value) return false
  if (getAppConfig().api_keys.some(configKey => safeEqual(configKey, value))) return true
  const hash = hashApiKey(value)
  return listManagedApiKeys().some(item => safeEqual(item.key_hash, hash))
}

export function requireApiKey(event: H3Event): string {
  const authorization = getHeader(event, 'authorization') || ''
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]
  const key = bearer || getHeader(event, 'x-api-key') || ''
  if (!isValidApiKey(key)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid API key',
      data: {
        error: {
          message: 'Invalid API key',
          type: 'invalid_request_error',
          code: 'invalid_api_key'
        }
      }
    })
  }
  return key
}
