export default defineEventHandler((event) => {
  requireAuth(event)
  const configKeys = getAppConfig().api_keys.map((key, index) => ({
    id: `config-${index}`,
    name: `config.yaml #${index + 1}`,
    prefix: apiKeyPrefix(key),
    source: 'config' as const,
    created_at: null
  }))
  const managedKeys = listManagedApiKeys().map(key => ({
    id: String(key.id),
    name: key.name,
    prefix: key.key_prefix,
    source: 'web' as const,
    created_at: key.created_at
  }))
  return [...configKeys, ...managedKeys]
})
