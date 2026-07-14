export function validateAuthCookieValue(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('auth cookie value is required')
  }
  const value = input.trim()
  const looksLikeCookiePair = /^auth\s*=/i.test(value) || /^[^=;\s]+\s*=[^=]/.test(value)
  if (/[;\r\n]/.test(value) || /\s/.test(value) || looksLikeCookiePair) {
    throw new Error('only the raw auth cookie value is accepted')
  }
  return value
}

export function parseAuthCookieValueLines(input: string) {
  const values: string[] = []
  const seen = new Set<string>()
  for (const [index, line] of input.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    let value: string
    try {
      value = validateAuthCookieValue(line)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`line ${index + 1}: ${message}`)
    }
    if (!seen.has(value)) {
      seen.add(value)
      values.push(value)
    }
  }
  if (!values.length) throw new Error('at least one auth cookie value is required')
  return values
}

export function normalizeStoredAuthCookieValue(input: string) {
  const value = input.trim()
  if (!value.includes(';') && !/^auth\s*=/i.test(value)) return value
  const authPart = value
    .split(';')
    .map(part => part.trim())
    .find(part => /^auth\s*=/i.test(part))
  if (!authPart) return value
  return authPart.slice(authPart.indexOf('=') + 1).trim()
}
