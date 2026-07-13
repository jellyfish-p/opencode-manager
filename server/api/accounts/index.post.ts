export default defineEventHandler(async (event) => {
  requireAuth(event)

  const body = await readBody<{ name?: string; auth_cookie?: string; refresh?: boolean }>(event)
  if (!body?.auth_cookie?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'auth_cookie is required' })
  }

  const account = createAccount({
    name: body.name,
    auth_cookie: body.auth_cookie
  })

  if (body.refresh !== false) {
    const refreshed = await refreshAccount(account.id)
    return toPublicAccount(refreshed)
  }

  return toPublicAccount(account)
})
