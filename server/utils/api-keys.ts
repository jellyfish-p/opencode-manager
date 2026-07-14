import { createHash, randomBytes } from 'node:crypto'
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

let configApiKeyHashes: Set<string> | null = null

export function isValidApiKey(key: string): boolean {
  const value = key.trim()
  if (!value) return false
  const hash = hashApiKey(value)
  if (!configApiKeyHashes) {
    configApiKeyHashes = new Set(getAppConfig().api_keys.map(hashApiKey))
  }
  return configApiKeyHashes.has(hash) || getManagedApiKeyHashes().has(hash)
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
