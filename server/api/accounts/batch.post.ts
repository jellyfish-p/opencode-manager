export default defineEventHandler(async (event) => {
  requireAuth(event)

  const body = await readBody<{
    name?: string
    auth_cookie_values?: unknown
    refresh?: boolean
  }>(event)
  let authCookieValues: string[]
  try {
    if (typeof body?.auth_cookie_values !== 'string') {
      throw new Error('auth_cookie_values is required')
    }
    authCookieValues = parseAuthCookieValueLines(body.auth_cookie_values)
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : 'Invalid auth cookie values'
    })
  }

  const created = authCookieValues.map((authCookie, index) => createAccount({
    name: body.name
      ? authCookieValues.length === 1
        ? body.name
        : `${body.name} ${index + 1}`
      : undefined,
    auth_cookie: authCookie
  }))
  ensureStableIpAssignments()
  const assignedCreated = created.map(account => getAccount(account.id)!)

  const accounts = body.refresh === false
    ? assignedCreated
    : await refreshAccountsByIds(assignedCreated.map(account => account.id))
  if (body.refresh === false) {
    for (const account of accounts) updateAccountPollSchedule(account)
  }

  const failed = body.refresh === false
    ? 0
    : accounts.filter(account => account.status === 'error').length
  return {
    created: accounts.length,
    synchronized: body.refresh === false ? 0 : accounts.length - failed,
    failed,
    accounts: accounts.map(toPublicAccount)
  }
})
