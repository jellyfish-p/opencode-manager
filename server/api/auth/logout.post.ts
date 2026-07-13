export default defineEventHandler(async (event) => {
  const token = requireAuth(event)
  logoutToken(token)
  deleteCookie(event, COOKIE_NAME, { path: '/' })
  return { ok: true }
})
