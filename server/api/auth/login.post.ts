export default defineEventHandler(async (event) => {
  const body = await readBody<{ key?: string }>(event)
  if (!body?.key) {
    throw createError({ statusCode: 400, statusMessage: 'key is required' })
  }

  const token = loginWithAdminKey(body.key)

  setCookie(event, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7
  })

  return { ok: true }
})
