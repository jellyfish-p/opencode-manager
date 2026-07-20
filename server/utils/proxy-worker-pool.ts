interface Waiter {
  resolve: (workerId: number) => void
  reject: (error: Error) => void
}

class BoundedFifoQueue<T> {
  private items = new Map<number, T>()
  private nextKey = 0

  constructor(readonly capacity: number) {}

  get size() {
    return this.items.size
  }

  push(item: T) {
    if (this.items.size >= this.capacity) return null
    const key = this.nextKey++
    this.items.set(key, item)
    return key
  }

  delete(key: number) {
    return this.items.delete(key)
  }

  shift(): T | undefined {
    const entry = this.items.entries().next().value as [number, T] | undefined
    if (!entry) return undefined
    const [key, item] = entry
    this.items.delete(key)
    return item
  }
}

export class ProxyPoolSaturatedError extends Error {
  constructor() {
    super('Proxy worker queue is full')
    this.name = 'ProxyPoolSaturatedError'
  }
}

export class ProxyRequestAbortedError extends Error {
  constructor() {
    super('Proxy request was aborted')
    this.name = 'ProxyRequestAbortedError'
  }
}

export class ProxyQueueTimeoutError extends Error {
  constructor() {
    super('Proxy worker queue wait timed out')
    this.name = 'ProxyQueueTimeoutError'
  }
}

export interface ProxyWorkerRunOptions {
  signal?: AbortSignal
  queueTimeoutMs?: number
}

export class ProxyWorkerPool {
  private idleWorkers: number[]
  private waiters: BoundedFifoQueue<Waiter>
  private totalWorkers: number
  private targetWorkers: number
  private nextWorkerId: number

  constructor(workerCount: number, readonly queueLimit: number) {
    if (!Number.isInteger(workerCount) || workerCount < 1) throw new Error('workerCount must be positive')
    if (!Number.isInteger(queueLimit) || queueLimit < 1) throw new Error('queueLimit must be positive')
    this.idleWorkers = Array.from({ length: workerCount }, (_, index) => workerCount - index - 1)
    this.waiters = new BoundedFifoQueue(queueLimit)
    this.totalWorkers = workerCount
    this.targetWorkers = workerCount
    this.nextWorkerId = workerCount
  }

  get workerCount() {
    return this.targetWorkers
  }

  get waiting() {
    return this.waiters.size
  }

  get active() {
    return this.totalWorkers - this.idleWorkers.length
  }

  setWorkerCount(workerCount: number) {
    if (!Number.isInteger(workerCount) || workerCount < 1) throw new Error('workerCount must be positive')
    this.targetWorkers = workerCount

    while (this.totalWorkers < this.targetWorkers) {
      const workerId = this.nextWorkerId++
      this.totalWorkers++
      this.release(workerId)
    }
    while (this.totalWorkers > this.targetWorkers && this.idleWorkers.length) {
      this.idleWorkers.pop()
      this.totalWorkers--
    }
  }

  async run(
    task: (workerId: number) => Promise<Response>,
    options: ProxyWorkerRunOptions = {}
  ): Promise<Response> {
    const workerId = await this.acquire(options)
    if (options.signal?.aborted) {
      this.release(workerId)
      throw new ProxyRequestAbortedError()
    }
    try {
      const response = await task(workerId)
      return this.holdWorkerForStream(workerId, response, options.signal)
    } catch (error) {
      this.release(workerId)
      throw error
    }
  }

  private acquire(options: ProxyWorkerRunOptions): Promise<number> {
    if (options.signal?.aborted) return Promise.reject(new ProxyRequestAbortedError())
    const workerId = this.idleWorkers.pop()
    if (workerId !== undefined) return Promise.resolve(workerId)

    return new Promise((resolve, reject) => {
      let settled = false
      let timeout: ReturnType<typeof setTimeout> | undefined
      let abortListener: (() => void) | undefined
      let queueKey: number | null = null

      const cleanup = () => {
        if (timeout) clearTimeout(timeout)
        if (abortListener && options.signal) {
          options.signal.removeEventListener('abort', abortListener)
        }
      }
      const waiter: Waiter = {
        resolve: nextWorkerId => {
          if (settled) return
          settled = true
          cleanup()
          resolve(nextWorkerId)
        },
        reject: error => {
          if (settled) return
          settled = true
          cleanup()
          reject(error)
        }
      }
      queueKey = this.waiters.push(waiter)
      if (queueKey === null) {
        waiter.reject(new ProxyPoolSaturatedError())
        return
      }

      const removeAndReject = (error: Error) => {
        if (settled) return
        if (queueKey !== null) this.waiters.delete(queueKey)
        waiter.reject(error)
      }
      if (options.signal) {
        abortListener = () => removeAndReject(new ProxyRequestAbortedError())
        options.signal.addEventListener('abort', abortListener, { once: true })
        if (options.signal.aborted) {
          abortListener()
          return
        }
      }
      if (options.queueTimeoutMs && options.queueTimeoutMs > 0) {
        timeout = setTimeout(
          () => removeAndReject(new ProxyQueueTimeoutError()),
          options.queueTimeoutMs
        )
        timeout.unref?.()
      }
    })
  }

  private release(workerId: number) {
    if (this.totalWorkers > this.targetWorkers) {
      this.totalWorkers--
      return
    }
    const waiter = this.waiters.shift()
    if (waiter) waiter.resolve(workerId)
    else this.idleWorkers.push(workerId)
  }

  private holdWorkerForStream(workerId: number, response: Response, signal?: AbortSignal) {
    if (!response.body) {
      this.release(workerId)
      return response
    }

    const reader = response.body.getReader()
    let released = false
    let abortListener: (() => void) | undefined
    const release = () => {
      if (released) return
      released = true
      if (abortListener && signal) signal.removeEventListener('abort', abortListener)
      this.release(workerId)
    }
    abortListener = () => {
      release()
      void reader.cancel(signal?.reason).catch(() => {})
    }
    if (signal) {
      signal.addEventListener('abort', abortListener, { once: true })
      if (signal.aborted) abortListener()
    }
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read()
          if (chunk.done) {
            release()
            controller.close()
          } else {
            controller.enqueue(chunk.value)
          }
        } catch (error) {
          release()
          controller.error(error)
        }
      },
      async cancel(reason) {
        release()
        await reader.cancel(reason)
      }
    })
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    })
  }
}

export interface AdaptiveWorkerSnapshot {
  workerCount: number
  active: number
  waiting: number
  minWorkers: number
  maxWorkers: number
  cpuPercent: number
  eventLoopLagMs: number
  idleForMs: number
}

export function nextAdaptiveWorkerCount(snapshot: AdaptiveWorkerSnapshot) {
  const {
    workerCount,
    active,
    waiting,
    minWorkers,
    maxWorkers,
    cpuPercent,
    eventLoopLagMs,
    idleForMs
  } = snapshot

  if (cpuPercent >= 85 || eventLoopLagMs >= 200) {
    return Math.max(minWorkers, Math.floor(workerCount * 0.75))
  }
  if (waiting > 0 && cpuPercent <= 70) {
    const demand = active + waiting
    return Math.min(
      maxWorkers,
      Math.max(workerCount + 16, Math.ceil(workerCount * 1.5), Math.min(demand, workerCount * 2))
    )
  }
  if (waiting === 0 && idleForMs >= 30_000 && active < workerCount * 0.35) {
    return Math.max(minWorkers, Math.ceil(Math.max(active * 1.25, workerCount * 0.8)))
  }
  return workerCount
}

export interface AdaptiveProxyWorkerOptions {
  minWorkers: number
  maxWorkers: number
  sampleIntervalMs?: number
}

export class AdaptiveProxyWorkerController {
  private timer: ReturnType<typeof setInterval> | null = null
  private previousCpuUsage = process.cpuUsage()
  private previousSampleAt = performance.now()
  private idleSince = Date.now()

  constructor(private pool: ProxyWorkerPool, private options: AdaptiveProxyWorkerOptions) {
    if (options.maxWorkers < options.minWorkers) throw new Error('maxWorkers must be >= minWorkers')
  }

  start() {
    if (this.timer) return
    const interval = this.options.sampleIntervalMs || 1000
    this.previousCpuUsage = process.cpuUsage()
    this.previousSampleAt = performance.now()
    this.timer = setInterval(() => this.sample(interval), interval)
    this.timer.unref?.()
  }

  stop() {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  private sample(interval: number) {
    const sampledAt = performance.now()
    const elapsedMs = Math.max(1, sampledAt - this.previousSampleAt)
    const currentUsage = process.cpuUsage()
    const usedMicros =
      currentUsage.user - this.previousCpuUsage.user +
      currentUsage.system - this.previousCpuUsage.system
    const cpuPercent = Math.min(100, usedMicros / (elapsedMs * 1000) * 100)
    const eventLoopLagMs = Math.max(0, elapsedMs - interval)
    this.previousCpuUsage = currentUsage
    this.previousSampleAt = sampledAt

    if (this.pool.waiting > 0 || this.pool.active >= this.pool.workerCount * 0.8) {
      this.idleSince = Date.now()
    }
    const next = nextAdaptiveWorkerCount({
      workerCount: this.pool.workerCount,
      active: this.pool.active,
      waiting: this.pool.waiting,
      minWorkers: this.options.minWorkers,
      maxWorkers: this.options.maxWorkers,
      cpuPercent,
      eventLoopLagMs,
      idleForMs: Date.now() - this.idleSince
    })
    if (next !== this.pool.workerCount) this.pool.setWorkerCount(next)
  }
}
