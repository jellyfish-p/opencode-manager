# Workspace ID Cache Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse `accounts.workspace_id` on refresh, automatically resolve and persist a replacement when the cached ID is stale.

**Architecture:** Split the OpenCode flow into one function that resolves a workspace ID through `/auth` and another that loads and validates a workspace page. `refreshAccount` passes the database cache into `fetchOpenCodeAccount`; the fetcher tries that cache first, falls back through `/auth` once, and returns the final ID to the existing persistence path.

**Tech Stack:** TypeScript, Bun test, Nuxt 4, Node.js fetch

## Global Constraints

- Do not modify the database schema.
- Do not log, throw, or return the auth Cookie value.
- Keep `buildAuthCookie` behavior unchanged.
- A refresh may fall back from a cached workspace ID at most once.
- Manual, batch, and scheduled refreshes must continue to use `refreshAccount`.
- A workspace page is valid only when its final URL is under `/workspace/` and its hydration HTML contains an account identifier before the fallback ID is assigned.

---

### Task 1: Load a valid cached workspace directly

**Files:**
- Create: `tests/opencode-workspace-cache.test.ts`
- Modify: `server/utils/opencode.ts:151-206`
- Modify: `server/utils/accounts.ts:10`

**Interfaces:**
- Consumes: `account.workspace_id: string | null` from the existing database record.
- Produces: `fetchOpenCodeAccount(authCookie: string, cachedWorkspaceId?: string | null): Promise<OpenCodeAccountInfo>`.
- Produces internally: `resolveWorkspaceId(cookie: string): Promise<string>` and `loadWorkspace(cookie: string, workspaceId: string): Promise<OpenCodeAccountInfo>`.

- [ ] **Step 1: Write failing tests for cached and uncached loading**

Create `tests/opencode-workspace-cache.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
bun test tests/opencode-workspace-cache.test.ts
```

Expected: the cached test fails because the current implementation ignores the second argument and requests `/auth`.

- [ ] **Step 3: Extract workspace resolution and page loading**

In `server/utils/opencode.ts`, replace the current `fetchOpenCodeAccount` implementation with these functions:

```ts
async function resolveWorkspaceId(cookie: string): Promise<string> {
  const authRes = await fetch(`${BASE}/auth`, {
    method: 'GET',
    redirect: 'manual',
    headers: commonHeaders(cookie)
  })

  const location = authRes.headers.get('location')
  let workspaceId: string | null = null

  if ([301, 302, 303, 307, 308].includes(authRes.status)) {
    workspaceId = extractWorkspaceId(location)
    if (!workspaceId) {
      throw new Error(
        `Auth redirected but not to workspace (status ${authRes.status}, location: ${location || 'none'}). Cookie may be invalid or expired.`
      )
    }
  } else if (authRes.status === 200) {
    const body = await authRes.text().catch(() => '')
    workspaceId = extractWorkspaceId(body)
  }

  if (!workspaceId) {
    throw new Error(
      `Failed to resolve workspace from /auth (status ${authRes.status}, location: ${location || 'none'}). Cookie may be invalid or expired.`
    )
  }

  return workspaceId
}

async function loadWorkspace(cookie: string, workspaceId: string): Promise<OpenCodeAccountInfo> {
  const goRes = await fetch(`${BASE}/workspace/${workspaceId}/go`, {
    method: 'GET',
    redirect: 'follow',
    headers: commonHeaders(cookie)
  })

  if (!goRes.ok) {
    throw new Error(`Failed to load workspace page (status ${goRes.status})`)
  }

  let finalPath = ''
  try {
    finalPath = new URL(goRes.url).pathname
  } catch {
    // An empty or invalid final URL is not a valid workspace response.
  }

  if (!finalPath.startsWith('/workspace/')) {
    throw new Error(
      `Workspace page redirected outside workspace (path: ${finalPath || 'unknown'})`
    )
  }

  const html = await goRes.text()
  const info = parseHydration(html)

  if (!info.email && !info.workspaceId) {
    throw new Error('Unable to parse account data from SSR page')
  }

  info.workspaceId = info.workspaceId || workspaceId
  return info
}

export async function fetchOpenCodeAccount(
  authCookie: string,
  cachedWorkspaceId?: string | null
): Promise<OpenCodeAccountInfo> {
  const cookie = buildAuthCookie(authCookie)
  const workspaceId = cachedWorkspaceId?.trim() || await resolveWorkspaceId(cookie)
  return loadWorkspace(cookie, workspaceId)
}
```

- [ ] **Step 4: Pass the database cache from the account service**

In `server/utils/accounts.ts`, replace:

```ts
const info = await fetchOpenCodeAccount(account.auth_cookie)
```

with:

```ts
const info = await fetchOpenCodeAccount(account.auth_cookie, account.workspace_id)
```

The existing `workspace_id: info.workspaceId` update remains unchanged and persists the first resolved ID.

- [ ] **Step 5: Run the cache tests and verify GREEN**

Run:

```powershell
bun test tests/opencode-workspace-cache.test.ts
```

Expected: 2 tests pass, 0 fail.

- [ ] **Step 6: Commit valid cache reuse**

```powershell
git add server/utils/opencode.ts server/utils/accounts.ts tests/opencode-workspace-cache.test.ts
git commit -m "feat: reuse cached OpenCode workspace id"
```

---

### Task 2: Recover from a stale workspace cache

**Files:**
- Modify: `tests/opencode-workspace-cache.test.ts`
- Modify: `server/utils/opencode.ts:206`

**Interfaces:**
- Consumes: `loadWorkspace(cookie: string, workspaceId: string)` from Task 1, which rejects invalid HTTP responses, redirects outside `/workspace/`, and unparseable HTML.
- Produces: one cache attempt followed by at most one `/auth` resolution and one retry.

- [ ] **Step 1: Append failing tests for fallback success and failure**

Append to `tests/opencode-workspace-cache.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
bun test tests/opencode-workspace-cache.test.ts
```

Expected: the two stale-cache tests fail because `fetchOpenCodeAccount` does not catch a failed cached load and resolve a replacement.

- [ ] **Step 3: Add a single fallback attempt**

Replace the Task 1 `fetchOpenCodeAccount` body with:

```ts
export async function fetchOpenCodeAccount(
  authCookie: string,
  cachedWorkspaceId?: string | null
): Promise<OpenCodeAccountInfo> {
  const cookie = buildAuthCookie(authCookie)
  const cachedId = cachedWorkspaceId?.trim()

  if (cachedId) {
    try {
      return await loadWorkspace(cookie, cachedId)
    } catch {
      // Resolve once through /auth below and replace the stale cache.
    }
  }

  const workspaceId = await resolveWorkspaceId(cookie)
  return loadWorkspace(cookie, workspaceId)
}
```

- [ ] **Step 4: Run the cache tests and verify GREEN**

Run:

```powershell
bun test tests/opencode-workspace-cache.test.ts
```

Expected: 4 tests pass, 0 fail; the error output contains no `secret-token`.

- [ ] **Step 5: Commit stale-cache recovery**

```powershell
git add server/utils/opencode.ts tests/opencode-workspace-cache.test.ts
git commit -m "fix: recover stale OpenCode workspace cache"
```

---

### Task 3: Verify the complete application

**Files:**
- Test: `tests/opencode-workspace-cache.test.ts`
- Test: `tests/opencode-cookie.test.ts`
- Test: `tests/auth-ssr.test.ts`
- Build: `nuxt.config.ts`

**Interfaces:**
- Consumes: the completed cached workspace flow from Tasks 1 and 2.
- Produces: verified test and production build evidence.

- [ ] **Step 1: Run all relevant tests together**

```powershell
bun test tests/opencode-workspace-cache.test.ts tests/opencode-cookie.test.ts tests/auth-ssr.test.ts
```

Expected: 9 tests pass, 0 fail.

- [ ] **Step 2: Run the production build**

```powershell
bun run build
```

Expected: exit code 0 and Nuxt reports `Build complete!`.

- [ ] **Step 3: Review the final diff**

```powershell
git diff HEAD~2 -- server/utils/opencode.ts server/utils/accounts.ts tests/opencode-workspace-cache.test.ts
```

Confirm that the diff contains no database migration, Cookie logging, unrelated refactor, or retry loop.
