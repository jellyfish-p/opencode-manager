# Auth Cookie Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the auth value stored in `auth_cookie` into `auth=<value>; oc_locale=zh` while accepting legacy full Cookie strings.

**Architecture:** Keep database storage and the OpenCode request flow unchanged. Replace the existing generic Cookie normalizer with one exported, deterministic function that extracts or accepts an auth value, validates it, and returns the exact Cookie header used by both OpenCode requests.

**Tech Stack:** TypeScript, Bun test, Nuxt 4, Node.js fetch

## Global Constraints

- Do not modify the database schema or migrate existing records.
- Never log or return the auth value.
- Pure auth values and legacy full Cookie strings must produce the same `auth=<value>; oc_locale=zh` output.
- A full Cookie string without a non-empty `auth` entry must fail with a clear error.
- Keep all other request headers, redirect handling, and workspace parsing unchanged.

---

### Task 1: Normalize the stored auth value

**Files:**
- Create: `tests/opencode-cookie.test.ts`
- Modify: `server/utils/opencode.ts:27`

**Interfaces:**
- Consumes: the existing `auth_cookie: string` value passed to `fetchOpenCodeAccount(authCookie: string)`.
- Produces: `buildAuthCookie(input: string): string`, returning the exact outbound Cookie header.

- [ ] **Step 1: Write the failing unit tests**

Create `tests/opencode-cookie.test.ts`:

```ts
import { expect, test } from 'bun:test'
import { buildAuthCookie } from '../server/utils/opencode'

test('builds the Cookie header from a raw auth value', () => {
  expect(buildAuthCookie('Fe26.2**token')).toBe('auth=Fe26.2**token; oc_locale=zh')
})

test('extracts auth from a legacy full Cookie string', () => {
  expect(buildAuthCookie('other=value; auth=Fe26.2**token; oc_locale=en'))
    .toBe('auth=Fe26.2**token; oc_locale=zh')
})

test('rejects a full Cookie string without auth', () => {
  expect(() => buildAuthCookie('session=value; oc_locale=en'))
    .toThrow('auth cookie is missing')
})

test('rejects an empty auth value', () => {
  expect(() => buildAuthCookie('auth= ; other=value'))
    .toThrow('auth cookie value is required')
})
```

- [ ] **Step 2: Run the unit tests and verify the expected red state**

Run:

```powershell
bun test tests/opencode-cookie.test.ts
```

Expected: FAIL because `buildAuthCookie` is not exported by `server/utils/opencode.ts`.

- [ ] **Step 3: Implement the minimal normalizer**

Replace the existing `normalizeCookie` function in `server/utils/opencode.ts` with:

```ts
export function buildAuthCookie(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new Error('auth cookie value is required')
  }

  let authValue = trimmed

  if (trimmed.includes('=')) {
    const authPart = trimmed
      .split(';')
      .map(part => part.trim())
      .find(part => part.slice(0, part.indexOf('=')).trim().toLowerCase() === 'auth')

    if (!authPart) {
      throw new Error('auth cookie is missing')
    }

    authValue = authPart.slice(authPart.indexOf('=') + 1).trim()
  }

  if (!authValue) {
    throw new Error('auth cookie value is required')
  }

  return `auth=${authValue}; oc_locale=${LOCALE}`
}
```

Update the first line of `fetchOpenCodeAccount` from:

```ts
const cookie = normalizeCookie(authCookie)
```

to:

```ts
const cookie = buildAuthCookie(authCookie)
```

- [ ] **Step 4: Run the Cookie unit tests and verify green**

Run:

```powershell
bun test tests/opencode-cookie.test.ts
```

Expected: 4 tests pass, 0 fail, with no warnings.

- [ ] **Step 5: Run the existing frontend auth regression test**

Run:

```powershell
bun test tests/auth-ssr.test.ts
```

Expected: 1 test passes, 0 fail.

- [ ] **Step 6: Build the production application**

Run:

```powershell
bun run build
```

Expected: exit code 0 and Nuxt reports `Build complete!`.

- [ ] **Step 7: Commit the implementation**

```powershell
git add server/utils/opencode.ts tests/opencode-cookie.test.ts
git commit -m "fix: normalize stored OpenCode auth value"
```
