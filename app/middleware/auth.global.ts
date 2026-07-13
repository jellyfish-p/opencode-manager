export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') return

  const { authenticated, check } = useAuth()

  if (authenticated.value === null) {
    await check()
  }

  if (!authenticated.value) {
    return navigateTo('/login')
  }
})
