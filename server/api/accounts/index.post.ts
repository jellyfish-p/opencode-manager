export default defineEventHandler(async (event) => {
  requireAuth(event)

  const body = await readBody<{ name?: string; auth_cookie?: unknown; refresh?: boolean }>(event)
  let authCookie: string
  try {
    authCookie = validateAuthCookieValue(body?.auth_cookie)
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : 'Invalid auth cookie value'
    })
  }

  const account = createAccount({
    name: body.name,
    auth_cookie: authCookie
  })
  ensureStableIpAssignments()
  const assignedAccount = getAccount(account.id)!

  if (body.refresh !== false) {
    const expanded = await expandAccountWorkspacesByIds([assignedAccount.id])
    const refreshed = await refreshAccountsByIds(expanded.map(item => item.id))
    return toPublicAccount(refreshed[0]!)
  }

  updateAccountPollSchedule(assignedAccount)
  return toPublicAccount(assignedAccount)
})
