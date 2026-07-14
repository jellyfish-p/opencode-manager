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
