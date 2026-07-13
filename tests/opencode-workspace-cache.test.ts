import { afterEach, expect, test } from 'bun:test'
import { fetchOpenCodeAccount } from '../server/utils/opencode'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function response(url: string, body = '', init: ResponseInit = {}) {
  const value = new Response(body, init)
  Object.defineProperty(value, 'url', { value: url })
  return value
}

function installFetch(responses: Response[]) {
  const calls: string[] = []

  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input))
    const next = responses.shift()
    if (!next) throw new Error('Unexpected fetch call')
    return next
  }) as typeof fetch

  return calls
}

function hydration(workspaceId: string, name: string) {
  return `<script>id: "${workspaceId}", name: "${name}"</script>`
}

test('loads a valid cached workspace without requesting auth', async () => {
  const calls = installFetch([
    response(
      'https://opencode.ai/workspace/wrk_CACHED123/go',
      hydration('wrk_CACHED123', 'Cached')
    )
  ])

  const info = await fetchOpenCodeAccount('token', 'wrk_CACHED123')

  expect(info.workspaceId).toBe('wrk_CACHED123')
  expect(calls).toEqual([
    'https://opencode.ai/workspace/wrk_CACHED123/go'
  ])
})

test('resolves a workspace through auth when no cache exists', async () => {
  const calls = installFetch([
    response('https://opencode.ai/auth', '', {
      status: 302,
      headers: { location: '/workspace/wrk_NEW123' }
    }),
    response(
      'https://opencode.ai/workspace/wrk_NEW123/go',
      hydration('wrk_NEW123', 'New')
    )
  ])

  const info = await fetchOpenCodeAccount('token')

  expect(info.workspaceId).toBe('wrk_NEW123')
  expect(calls).toEqual([
    'https://opencode.ai/auth',
    'https://opencode.ai/workspace/wrk_NEW123/go'
  ])
})

test('resolves and returns a new workspace when the cache is stale', async () => {
  const calls = installFetch([
    response('https://opencode.ai/auth/authorize', '<html>login</html>'),
    response('https://opencode.ai/auth', '', {
      status: 302,
      headers: { location: '/workspace/wrk_REPLACED123' }
    }),
    response(
      'https://opencode.ai/workspace/wrk_REPLACED123/go',
      hydration('wrk_REPLACED123', 'Replacement')
    )
  ])

  const info = await fetchOpenCodeAccount('token', 'wrk_STALE123')

  expect(info.workspaceId).toBe('wrk_REPLACED123')
  expect(calls).toEqual([
    'https://opencode.ai/workspace/wrk_STALE123/go',
    'https://opencode.ai/auth',
    'https://opencode.ai/workspace/wrk_REPLACED123/go'
  ])
})

test('surfaces a safe error when the replacement workspace is invalid', async () => {
  installFetch([
    response('https://opencode.ai/auth/authorize', '<html>login</html>'),
    response('https://opencode.ai/auth', '', {
      status: 302,
      headers: { location: '/workspace/wrk_REPLACED123' }
    }),
    response(
      'https://opencode.ai/workspace/wrk_REPLACED123/go',
      '<html>no account data</html>'
    )
  ])

  await expect(fetchOpenCodeAccount('secret-token', 'wrk_STALE123'))
    .rejects.toThrow('Unable to parse account data from SSR page')
})
