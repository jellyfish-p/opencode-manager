import { describe, expect, test } from 'bun:test'
import {
  nextAdaptiveWorkerCount,
  ProxyPoolSaturatedError,
  ProxyWorkerPool
} from '../server/utils/proxy-worker-pool'

describe('proxy worker pool', () => {
  test('holds a worker until its response stream is consumed', async () => {
    const pool = new ProxyWorkerPool(1, 2)
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const first = await pool.run(async () => new Response(new ReadableStream({
      start(value) { controller = value }
    })))
    let secondStarted = false
    const secondPromise = pool.run(async () => {
      secondStarted = true
      return new Response('second')
    })

    await Promise.resolve()
    expect(secondStarted).toBe(false)
    controller!.close()
    await first.text()
    const second = await secondPromise
    expect(secondStarted).toBe(true)
    expect(await second.text()).toBe('second')
  })

  test('rejects immediately when the bounded queue is full', async () => {
    const pool = new ProxyWorkerPool(1, 1)
    const first = await pool.run(async () => new Response(new ReadableStream()))
    const queued = pool.run(async () => new Response('queued'))
    await expect(pool.run(async () => new Response('overflow'))).rejects.toBeInstanceOf(ProxyPoolSaturatedError)

    await first.body!.cancel()
    expect(await (await queued).text()).toBe('queued')
  })

  test('adds reusable workers to drain queued streams', async () => {
    const pool = new ProxyWorkerPool(1, 4)
    const first = await pool.run(async () => new Response(new ReadableStream()))
    let secondStarted = false
    const secondPromise = pool.run(async () => {
      secondStarted = true
      return new Response('second')
    })

    pool.setWorkerCount(2)
    const second = await secondPromise
    expect(secondStarted).toBe(true)
    expect(pool.workerCount).toBe(2)
    await first.body!.cancel()
    expect(await second.text()).toBe('second')
  })

  test('removes queued work when its requester disconnects', async () => {
    const pool = new ProxyWorkerPool(1, 2)
    const first = await pool.run(async () => new Response(new ReadableStream()))
    const abortController = new AbortController()
    let queuedStarted = false
    let queuedOutcome = 'pending'
    const queued = pool.run(async () => {
      queuedStarted = true
      return new Response('queued')
    }, { signal: abortController.signal }).then(
      () => { queuedOutcome = 'resolved' },
      () => { queuedOutcome = 'rejected' }
    )

    await Promise.resolve()
    expect(pool.waiting).toBe(1)
    abortController.abort()
    const settledAfterAbort = await Promise.race([
      queued.then(() => true),
      Bun.sleep(10).then(() => false)
    ])
    const waitingAfterAbort = pool.waiting
    const outcomeAfterAbort = queuedOutcome

    await first.body!.cancel()
    await queued
    expect(waitingAfterAbort).toBe(0)
    expect(settledAfterAbort).toBe(true)
    expect(outcomeAfterAbort).toBe('rejected')
    expect(queuedStarted).toBe(false)
  })

  test('releases an active streaming worker when its requester disconnects', async () => {
    const pool = new ProxyWorkerPool(1, 1)
    const abortController = new AbortController()
    const response = await pool.run(
      async () => new Response(new ReadableStream()),
      { signal: abortController.signal }
    )

    expect(pool.active).toBe(1)
    abortController.abort()
    await Promise.resolve()
    const activeAfterAbort = pool.active

    await response.body!.cancel()
    expect(activeAfterAbort).toBe(0)
  })

  test('expires queued work instead of allowing unbounded queue latency', async () => {
    const pool = new ProxyWorkerPool(1, 1)
    const first = await pool.run(async () => new Response(new ReadableStream()))
    let queuedStarted = false
    let queuedOutcome = 'pending'
    const queued = pool.run(async () => {
      queuedStarted = true
      return new Response('queued')
    }, { queueTimeoutMs: 10 }).then(
      () => { queuedOutcome = 'resolved' },
      () => { queuedOutcome = 'rejected' }
    )

    await Bun.sleep(25)
    const waitingAfterTimeout = pool.waiting
    const outcomeAfterTimeout = queuedOutcome

    await first.body!.cancel()
    await queued
    expect(waitingAfterTimeout).toBe(0)
    expect(outcomeAfterTimeout).toBe('rejected')
    expect(queuedStarted).toBe(false)
  })

  test('scales by demand but contracts at CPU and event-loop limits', () => {
    const base = {
      workerCount: 64,
      active: 64,
      waiting: 1000,
      minWorkers: 64,
      maxWorkers: 1024,
      eventLoopLagMs: 0,
      idleForMs: 0
    }
    expect(nextAdaptiveWorkerCount({ ...base, cpuPercent: 30 })).toBe(128)
    expect(nextAdaptiveWorkerCount({ ...base, cpuPercent: 90 })).toBe(64)
    expect(nextAdaptiveWorkerCount({
      ...base,
      workerCount: 256,
      cpuPercent: 30,
      eventLoopLagMs: 250
    })).toBe(192)
  })
})
