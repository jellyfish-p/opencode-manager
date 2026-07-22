import { afterAll, beforeAll, expect, test } from 'bun:test'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'

let server: ChildProcess
let baseUrl: string
let adminKey: string
let testDirectory: string

async function reservePort() {
  return await new Promise<number>((resolve, reject) => {
    const socket = createServer()
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address()
      if (!address || typeof address === 'string') {
        socket.close()
        reject(new Error('Failed to reserve a test port'))
        return
      }

      socket.close(error => error ? reject(error) : resolve(address.port))
    })
  })
}

async function waitForServer(url: string) {
  const deadline = Date.now() + 15_000

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Test server exited with code ${server.exitCode}`)
    }

    try {
      const response = await fetch(`${url}/api/auth/me`)
      if (response.status === 401) return
    } catch {
      // The server is still starting.
    }

    await Bun.sleep(50)
  }

  throw new Error('Timed out waiting for the test server')
}

beforeAll(async () => {
  const port = await reservePort()
  const rawConfig = await readFile('config.yaml', 'utf8')
  const config = parse(rawConfig) as { admin_key: string }

  adminKey = config.admin_key
  testDirectory = await mkdtemp(join(tmpdir(), 'opencode-manager-auth-'))
  await writeFile(join(testDirectory, 'config.yaml'), rawConfig)

  baseUrl = `http://127.0.0.1:${port}`
  server = spawn('node', [resolve('.output/server/index.mjs')], {
    cwd: testDirectory,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      NITRO_HOST: '127.0.0.1',
      NITRO_PORT: String(port)
    },
    stdio: 'ignore'
  })

  await waitForServer(baseUrl)
})

afterAll(async () => {
  if (server && server.exitCode === null) {
    server.kill()
    await new Promise<void>(resolveExit => server.once('exit', () => resolveExit()))
  }

  if (testDirectory) {
    await rm(testDirectory, { recursive: true, force: true })
  }
})

test('an authenticated SSR request can render a protected page', async () => {
  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: adminKey })
  })
  const sessionCookie = loginResponse.headers.get('set-cookie')?.split(';', 1)[0]

  expect(loginResponse.status).toBe(200)
  expect(sessionCookie).toStartWith('ocm_session=')

  const pageResponse = await fetch(`${baseUrl}/accounts`, {
    headers: { cookie: sessionCookie! },
    redirect: 'manual'
  })

  expect(pageResponse.status).toBe(200)
  expect(pageResponse.headers.get('location')).toBeNull()

  const ipPoolResponse = await fetch(`${baseUrl}/ip-pool`, {
    headers: { cookie: sessionCookie! },
    redirect: 'manual'
  })
  expect(ipPoolResponse.status).toBe(200)
  expect(await ipPoolResponse.text()).toContain('IP 池')
})
