import type { Socket } from 'node:net'
import tls, { type TLSSocket } from 'node:tls'
import { SocksClient, type SocksProxy } from 'socks'

const SOCKS_CONNECT_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 5
const MAX_RESPONSE_HEAD_BYTES = 64 * 1024
const HEADER_SEPARATOR = Buffer.from('\r\n\r\n')
const LINE_SEPARATOR = Buffer.from('\r\n')

type TransportSocket = Socket | TLSSocket

interface ResponseHead {
  status: number
  statusText: string
  headers: Headers
}

function decodeCredential(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function parseProxy(proxyUrl: string): SocksProxy {
  const url = new URL(proxyUrl)
  return {
    host: url.hostname.replace(/^\[(.*)\]$/, '$1'),
    port: Number(url.port),
    type: 5,
    userId: url.username ? decodeCredential(url.username) : undefined,
    password: url.password ? decodeCredential(url.password) : undefined
  }
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError')
}

async function connectThroughSocks(
  proxy: SocksProxy,
  url: URL,
  signal: AbortSignal
): Promise<TransportSocket> {
  if (signal.aborted) throw abortReason(signal)

  const connection = SocksClient.createConnection({
    command: 'connect',
    proxy,
    timeout: SOCKS_CONNECT_TIMEOUT_MS,
    destination: {
      host: url.hostname,
      port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80)
    }
  })

  const socket = await new Promise<Socket>((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      if (settled) return
      settled = true
      reject(abortReason(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void connection.then(({ socket }) => {
      signal.removeEventListener('abort', onAbort)
      if (settled || signal.aborted) {
        socket.destroy()
        if (!settled) reject(abortReason(signal))
        return
      }
      settled = true
      resolve(socket.setNoDelay())
    }, (error) => {
      signal.removeEventListener('abort', onAbort)
      if (settled) return
      settled = true
      reject(error)
    })
  })

  if (url.protocol !== 'https:') return socket

  return new Promise<TLSSocket>((resolve, reject) => {
    const secureSocket = tls.connect({
      socket,
      servername: url.hostname,
      ALPNProtocols: ['http/1.1']
    })
    let settled = false
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
      secureSocket.removeListener('secureConnect', onSecure)
      secureSocket.removeListener('error', onError)
    }
    const onSecure = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(secureSocket.setNoDelay())
    }
    const onError = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      secureSocket.destroy()
      reject(abortReason(signal))
    }
    secureSocket.once('secureConnect', onSecure)
    secureSocket.once('error', onError)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function parseResponseHead(buffer: Buffer): ResponseHead {
  const lines = buffer.toString('latin1').split('\r\n')
  const statusLine = lines.shift() || ''
  const match = statusLine.match(/^HTTP\/1\.[01]\s+(\d{3})(?:\s+(.*))?$/)
  if (!match) throw new Error('Invalid HTTP response from SOCKS upstream')

  const headers = new Headers()
  for (const line of lines) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    headers.append(
      line.slice(0, separator).trim(),
      line.slice(separator + 1).trim()
    )
  }
  return {
    status: Number(match[1]),
    statusText: match[2] || '',
    headers
  }
}

function requestHead(
  url: URL,
  method: string,
  headers: Headers,
  body: Buffer | null
) {
  const requestHeaders = new Headers(headers)
  requestHeaders.set(
    'host',
    url.port ? `${url.hostname}:${url.port}` : url.hostname
  )
  requestHeaders.set('connection', 'close')
  requestHeaders.set('accept-encoding', 'identity')
  if (body) requestHeaders.set('content-length', String(body.length))
  else requestHeaders.delete('content-length')

  const lines = [`${method} ${url.pathname}${url.search} HTTP/1.1`]
  requestHeaders.forEach((value, name) => {
    lines.push(`${name}: ${value}`)
  })
  return Buffer.from(`${lines.join('\r\n')}\r\n\r\n`)
}

function isRedirectStatus(status: number) {
  return [301, 302, 303, 307, 308].includes(status)
}

async function fetchOnce(
  proxy: SocksProxy,
  url: URL,
  method: string,
  headers: Headers,
  body: Buffer | null,
  signal: AbortSignal,
  redirected: boolean
): Promise<Response> {
  const socket = await connectThroughSocks(proxy, url, signal)

  return new Promise<Response>((resolve, reject) => {
    let headBuffer = Buffer.alloc(0)
    let responseResolved = false
    let bodyController: ReadableStreamDefaultController<Uint8Array> | null = null
    let bodyMode: 'chunked' | 'length' | 'close' = 'close'
    let remainingLength = 0
    let chunkBuffer = Buffer.alloc(0)
    let chunkLength: number | null = null
    let finished = false

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
    }
    const finish = () => {
      if (finished) return
      finished = true
      cleanup()
      bodyController?.close()
      socket.destroy()
    }
    const fail = (error: unknown) => {
      if (finished) return
      finished = true
      cleanup()
      socket.destroy()
      if (responseResolved) bodyController?.error(error)
      else reject(error)
    }
    const enqueue = (value: Buffer) => {
      if (value.length) bodyController?.enqueue(new Uint8Array(value))
    }
    const consumeBody = (value: Buffer) => {
      if (finished || !value.length) return
      if (bodyMode === 'close') {
        enqueue(value)
        return
      }
      if (bodyMode === 'length') {
        const length = Math.min(value.length, remainingLength)
        enqueue(value.subarray(0, length))
        remainingLength -= length
        if (remainingLength === 0) finish()
        return
      }

      chunkBuffer = Buffer.concat([chunkBuffer, value])
      while (!finished) {
        if (chunkLength === null) {
          const lineEnd = chunkBuffer.indexOf(LINE_SEPARATOR)
          if (lineEnd < 0) return
          const sizeText = chunkBuffer
            .subarray(0, lineEnd)
            .toString('ascii')
            .split(';', 1)[0]
          const size = Number.parseInt(sizeText || '', 16)
          if (!Number.isFinite(size) || size < 0) {
            fail(new Error('Invalid chunked response from SOCKS upstream'))
            return
          }
          chunkBuffer = chunkBuffer.subarray(lineEnd + LINE_SEPARATOR.length)
          if (size === 0) {
            finish()
            return
          }
          chunkLength = size
        }
        if (chunkBuffer.length < chunkLength + LINE_SEPARATOR.length) return
        const suffix = chunkBuffer.subarray(
          chunkLength,
          chunkLength + LINE_SEPARATOR.length
        )
        if (!suffix.equals(LINE_SEPARATOR)) {
          fail(new Error('Invalid chunk boundary from SOCKS upstream'))
          return
        }
        enqueue(chunkBuffer.subarray(0, chunkLength))
        chunkBuffer = chunkBuffer.subarray(chunkLength + LINE_SEPARATOR.length)
        chunkLength = null
      }
    }
    const onAbort = () => fail(abortReason(signal))

    socket.on('data', (value: Buffer) => {
      if (responseResolved) {
        consumeBody(value)
        return
      }

      headBuffer = Buffer.concat([headBuffer, value])
      if (headBuffer.length > MAX_RESPONSE_HEAD_BYTES) {
        fail(new Error('SOCKS upstream response headers are too large'))
        return
      }
      const headEnd = headBuffer.indexOf(HEADER_SEPARATOR)
      if (headEnd < 0) return

      try {
        const parsed = parseResponseHead(headBuffer.subarray(0, headEnd))
        const bodyStart = headBuffer.subarray(headEnd + HEADER_SEPARATOR.length)
        const noBody = method === 'HEAD' ||
          parsed.status === 204 ||
          parsed.status === 205 ||
          parsed.status === 304
        const transferEncoding = parsed.headers.get('transfer-encoding') || ''
        const contentLength = parsed.headers.get('content-length')
        if (/chunked/i.test(transferEncoding)) {
          bodyMode = 'chunked'
        } else if (contentLength !== null) {
          bodyMode = 'length'
          remainingLength = Number(contentLength)
          if (!Number.isFinite(remainingLength) || remainingLength < 0) {
            throw new Error('Invalid content length from SOCKS upstream')
          }
        }

        parsed.headers.delete('connection')
        parsed.headers.delete('transfer-encoding')
        const stream = noBody
          ? null
          : new ReadableStream<Uint8Array>({
              start(controller) {
                bodyController = controller
              },
              cancel() {
                if (finished) return
                finished = true
                cleanup()
                socket.destroy()
              }
            })
        const response = new Response(stream, {
          status: parsed.status,
          statusText: parsed.statusText,
          headers: parsed.headers
        })
        Object.defineProperties(response, {
          url: { configurable: true, value: url.href },
          redirected: { configurable: true, value: redirected }
        })
        responseResolved = true
        resolve(response)
        if (noBody || (bodyMode === 'length' && remainingLength === 0)) finish()
        else consumeBody(bodyStart)
      } catch (error) {
        fail(error)
      }
    })
    socket.once('end', () => {
      if (!responseResolved) {
        fail(new Error('SOCKS upstream closed before sending response headers'))
      } else if (bodyMode === 'close') {
        finish()
      } else if (!finished) {
        fail(new Error('SOCKS upstream closed before the response body completed'))
      }
    })
    socket.once('error', fail)
    signal.addEventListener('abort', onAbort, { once: true })
    socket.write(requestHead(url, method, headers, body))
    if (body?.length) socket.write(body)
  })
}

export function createSocksProxyFetch(proxyUrl: string): typeof fetch {
  const proxy = parseProxy(proxyUrl)
  return (async (input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
    const request = new Request(input, init)
    let url = new URL(request.url)
    let method = request.method
    let headers = new Headers(request.headers)
    let body = ['GET', 'HEAD'].includes(method)
      ? null
      : Buffer.from(await request.arrayBuffer())

    for (let redirectCount = 0; ; redirectCount++) {
      const response = await fetchOnce(
        proxy,
        url,
        method,
        headers,
        body,
        request.signal,
        redirectCount > 0
      )
      if (!isRedirectStatus(response.status) || !response.headers.has('location')) {
        return response
      }
      if (request.redirect === 'manual') return response
      await response.body?.cancel()
      if (request.redirect === 'error') {
        throw new TypeError('Redirect mode is set to error')
      }
      if (redirectCount >= MAX_REDIRECTS) {
        throw new TypeError('Maximum redirect count exceeded')
      }

      const nextUrl = new URL(response.headers.get('location')!, url)
      const nextHeaders = new Headers(headers)
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && method === 'POST')
      ) {
        method = 'GET'
        body = null
        nextHeaders.delete('content-length')
        nextHeaders.delete('content-type')
      }
      if (nextUrl.origin !== url.origin) {
        nextHeaders.delete('authorization')
        nextHeaders.delete('cookie')
      }
      url = nextUrl
      headers = nextHeaders
    }
  }) as typeof fetch
}
