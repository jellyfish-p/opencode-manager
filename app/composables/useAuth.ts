export function useAuth() {
  const authenticated = useState<boolean | null>('auth', () => null)
  const loading = useState('auth-loading', () => false)
  const requestFetch = useRequestFetch()

  async function check() {
    loading.value = true
    try {
      await requestFetch('/api/auth/me')
      authenticated.value = true
    } catch {
      authenticated.value = false
    } finally {
      loading.value = false
    }
  }

  async function login(key: string) {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: { key }
    })
    authenticated.value = true
  }

  async function logout() {
    try {
      await $fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      authenticated.value = false
      await navigateTo('/login')
    }
  }

  return { authenticated, loading, check, login, logout }
}
