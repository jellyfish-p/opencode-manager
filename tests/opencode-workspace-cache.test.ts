import { afterEach, expect, test } from 'bun:test'
import {
  fetchOpenCodeAccount,
  fetchOpenCodeAccounts,
  fetchOpenCodeApiKey
} from '../server/utils/opencode'

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

function multiWorkspaceHydration(
  currentWorkspaceId: string,
  subscriptionId = 'sub_SECOND'
) {
  return `
    <script>
      _$HY.r["session.get[\\"${currentWorkspaceId}\\"]"] = {};
      _$HY.r["lite.subscription.get[\\"${currentWorkspaceId}\\"]"] = {};
      $R[1] = [
        { id: "wrk_FIRST123", name: "First", slug: null },
        { id: "wrk_SECOND456", name: "Second", slug: null }
      ];
      $R[2] = { liteSubscriptionID: "${subscriptionId}" };
    </script>
  `
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

test('puts an abort deadline on the workspace refresh request', async () => {
  const calls: string[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(String(input))
    if (!init?.signal) {
      throw new Error('workspace request has no abort deadline')
    }
    return response(
      'https://opencode.ai/workspace/wrk_CACHED123/go',
      hydration('wrk_CACHED123', 'Cached')
    )
  }) as typeof fetch

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

test('does not restart the auth redirect flow when a cached workspace fails', async () => {
  const calls = installFetch([
    response('https://opencode.ai/auth/authorize', '<html>login</html>')
  ])

  await expect(fetchOpenCodeAccount('token', 'wrk_STALE123'))
    .rejects.toThrow('Workspace page redirected outside workspace')
  expect(calls).toEqual([
    'https://opencode.ai/workspace/wrk_STALE123/go'
  ])
})

test('surfaces a safe error when a newly resolved workspace is invalid', async () => {
  installFetch([
    response('https://opencode.ai/auth', '', {
      status: 302,
      headers: { location: '/workspace/wrk_REPLACED123' }
    }),
    response(
      'https://opencode.ai/workspace/wrk_REPLACED123/go',
      '<html>no account data</html>'
    )
  ])

  await expect(fetchOpenCodeAccount('secret-token'))
    .rejects.toThrow('Unable to parse account data from SSR page')
})

test('puts an abort deadline on the API key request', async () => {
  globalThis.fetch = (async (
    _input: string | URL | Request,
    init?: RequestInit
  ) => {
    if (!init?.signal) throw new Error('API key request has no abort deadline')
    return response(
      'https://opencode.ai/workspace/wrk_CACHED123/keys',
      '<script>key: "sk-example"</script>'
    )
  }) as typeof fetch

  await expect(fetchOpenCodeApiKey('token', 'wrk_CACHED123'))
    .resolves.toBe('sk-example')
})

test('keeps the requested workspace when hydration lists another workspace first', async () => {
  installFetch([
    response(
      'https://opencode.ai/workspace/wrk_SECOND456/go',
      multiWorkspaceHydration('wrk_SECOND456')
    )
  ])

  const info = await fetchOpenCodeAccount('token', 'wrk_SECOND456')

  expect(info.workspaceId).toBe('wrk_SECOND456')
  expect(info.workspaceName).toBe('Second')
})

test('loads every workspace exposed by one auth cookie', async () => {
  const calls = installFetch([
    response('https://opencode.ai/auth', '', {
      status: 302,
      headers: { location: '/workspace/wrk_FIRST123' }
    }),
    response(
      'https://opencode.ai/workspace/wrk_FIRST123/go',
      multiWorkspaceHydration('wrk_FIRST123', 'sub_FIRST')
    ),
    response(
      'https://opencode.ai/workspace/wrk_SECOND456/go',
      multiWorkspaceHydration('wrk_SECOND456', 'sub_SECOND')
    )
  ])

  const infos = await fetchOpenCodeAccounts('token')

  expect(infos.map(info => ({
    workspaceId: info.workspaceId,
    workspaceName: info.workspaceName,
    subscriptionId: info.liteSubscriptionId
  }))).toEqual([
    {
      workspaceId: 'wrk_FIRST123',
      workspaceName: 'First',
      subscriptionId: 'sub_FIRST'
    },
    {
      workspaceId: 'wrk_SECOND456',
      workspaceName: 'Second',
      subscriptionId: 'sub_SECOND'
    }
  ])
  expect(calls).toEqual([
    'https://opencode.ai/auth',
    'https://opencode.ai/workspace/wrk_FIRST123/go',
    'https://opencode.ai/workspace/wrk_SECOND456/go'
  ])
})
