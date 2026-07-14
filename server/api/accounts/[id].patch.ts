export default defineEventHandler(async (event) => {
  requireAuth(event)
  const id = Number(getRouterParam(event, 'id'))

  const body = await readBody<{
    name?: string
    auth_cookie?: string
    status?: 'pending' | 'active' | 'error' | 'disabled'
  }>(event)

  const updated = await updateAccountSettings(id, body)

  return toPublicAccount(updated)
})
