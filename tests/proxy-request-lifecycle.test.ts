import { afterEach, describe, expect, test } from 'bun:test'
import { createServer, get, type Server } from 'node:http'
import { createApp, eventHandler, toNodeListener, type H3Event } from 'h3'
import { ProxyRequestAbortedError, ProxyWorkerPool } from '../server/utils/proxy-worker-pool'
import { createProxyRequestLifecycle } from '../server/utils/proxy-request-lifecycle'

const servers = new Set<Server>()

afterEach(async () => {
  await Promise.all(Array.from(servers, server => new Promise<void>(resolve => {
    server.closeAllConnections?.()
    server.close(() => resolve())
  })))
  servers.clear()
})

async function listen(server: Server) {
  servers.add(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as { port: number }).port
}

async function waitFor(predicate: () => boolean, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition')
    await Bun.sleep(5)
  }
}

async function runRequest(
  event: H3Event,
  pool: ProxyWorkerPool,
  task: () => Promise<Response>
) {
  const lifecycle = createProxyRequestLifecycle(event)
  try {
    return await pool.run(task, { signal: lifecycle.signal })
  } catch (error) {
    if (error instanceof ProxyRequestAbortedError) {
      return new Response(null, { status: 499 })
    }
    throw error
  }
}

describe('proxy request lifecycle', () => {
  test('releases a streaming worker when the HTTP client disconnects', async () => {
    const pool = new ProxyWorkerPool(1, 2)
    let calls = 0
    const app = createApp()
    app.use(eventHandler(event => runRequest(event, pool, async () => {
      calls++
      if (calls > 1) return new Response('ok')
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('started'))
        }
      }))
    })))
    const port = await listen(createServer(toNodeListener(app)))

    await new Promise<void>((resolve, reject) => {
      const request = get(`http://127.0.0.1:${port}/stream`, response => {
        response.once('data', () => {
          response.destroy()
          resolve()
        })
      })
      request.on('error', error => {
        if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error)
      })
    })
    await waitFor(() => pool.active === 0)

    const body = await (await fetch(`http://127.0.0.1:${port}/probe`)).text()
    expect(body).toBe('ok')
    expect(calls).toBe(2)
  })

  test('drops an HTTP request that disconnects while queued', async () => {
    const pool = new ProxyWorkerPool(1, 2)
    let calls = 0
    let firstController: ReadableStreamDefaultController<Uint8Array> | undefined
    const app = createApp()
    app.use(eventHandler(event => runRequest(event, pool, async () => {
      calls++
      if (calls > 1) return new Response('ok')
      return new Response(new ReadableStream({
        start(controller) {
          firstController = controller
          controller.enqueue(new TextEncoder().encode('active'))
        }
      }))
    })))
    const port = await listen(createServer(toNodeListener(app)))

    const activeRequest = get(`http://127.0.0.1:${port}/active`)
    activeRequest.on('response', response => response.once('data', () => {}))
    activeRequest.on('error', () => {})
    await waitFor(() => calls === 1)

    const abandonedRequest = get(`http://127.0.0.1:${port}/abandoned`)
    abandonedRequest.on('error', () => {})
    await waitFor(() => pool.waiting === 1)
    abandonedRequest.destroy()
    await waitFor(() => pool.waiting === 0)

    firstController!.close()
    await waitFor(() => pool.active === 0)
    expect(calls).toBe(1)

    activeRequest.destroy()
    const body = await (await fetch(`http://127.0.0.1:${port}/probe`)).text()
    expect(body).toBe('ok')
    expect(calls).toBe(2)
  })
})
