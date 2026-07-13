import { randomBytes } from 'node:crypto'
const COOKIE_NAME = 'ocm_session'

export function createAuthToken() {
  return randomBytes(32).toString('hex')
}

export function loginWithAdminKey(key: string) {
  const config = getAppConfig()
  if (key !== config.admin_key) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid admin key' })
  }

  cleanExpiredSessions()
  const token = createAuthToken()
  createSession(token)
  return token
}

export function logoutToken(token: string) {
  deleteSession(token)
}

export function requireAuth(event: { node: { req: { headers: { cookie?: string } } } }) {
  const cookieHeader = event.node.req.headers.cookie || ''
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`))
  const token = match?.[1]

  if (!token || !findSession(token)) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  return token
}

export { COOKIE_NAME }
