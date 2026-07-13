import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'

export interface AppConfig {
  admin_key: string
  api_keys: string[]
}

let cached: AppConfig | null = null

export function getAppConfig(): AppConfig {
  if (cached) return cached

  const path = resolve(process.cwd(), 'config.yaml')
  if (!existsSync(path)) {
    throw createError({ statusCode: 500, statusMessage: 'config.yaml not found' })
  }

  const raw = readFileSync(path, 'utf-8')
  const data = parse(raw) as AppConfig & { api_keys?: string[] | string }

  if (!data?.admin_key) {
    throw createError({ statusCode: 500, statusMessage: 'admin_key missing in config.yaml' })
  }

  const apiKeys = Array.isArray(data.api_keys)
    ? data.api_keys
    : typeof data.api_keys === 'string'
      ? [data.api_keys]
      : []
  cached = {
    ...data,
    api_keys: apiKeys.map(key => key.trim()).filter(Boolean)
  }
  return cached
}
