export default defineEventHandler(async (event) => {
  requireAuth(event)
  const id = Number(getRouterParam(event, 'id'))

  const body = await readBody<{
    name?: string
    auth_cookie?: unknown
    status?: 'pending' | 'active' | 'error' | 'disabled'
  }>(event)
  let authCookie: string | undefined
  if (body.auth_cookie !== undefined) {
    try {
      authCookie = validateAuthCookieValue(body.auth_cookie)
    } catch (error) {
      throw createError({
        statusCode: 400,
        statusMessage: error instanceof Error ? error.message : 'Invalid auth cookie value'
      })
    }
  }

  const updated = await updateAccountSettings(id, {
    name: body.name,
    status: body.status,
    ...(authCookie !== undefined ? { auth_cookie: authCookie } : {})
  })

  return toPublicAccount(updated)
})
