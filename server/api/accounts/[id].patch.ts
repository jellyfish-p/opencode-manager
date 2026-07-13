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
    ...(body.status !== undefined ? { status: body.status } : {})
  })

  return toPublicAccount(updated!)
})
