export default defineEventHandler((event) => {
  requireAuth(event)
  return { authenticated: true }
})
