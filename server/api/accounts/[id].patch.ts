export default defineEventHandler(async (event) => {
  requireAuth(event)
  const id = Number(getRouterParam(event, 'id'))
  const account = getAccount(id)
  if (!account) {
    throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  }

  const body = await readBody<{
    name?: string
    auth_cookie?: string
    status?: 'pending' | 'active' | 'error' | 'disabled'
  }>(event)

  const updated = updateAccount(id, {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.auth_cookie !== undefined ? { auth_cookie: body.auth_cookie.trim() } : {}),
    ...(body.status !== undefined
      ? body.status === 'disabled'
        ? { status: body.status, disabled_reason: 'manual', auto_enable_at: null }
        : { status: body.status, disabled_reason: null, auto_enable_at: null }
      : {})
  })

  return toPublicAccount(updated!)
})
