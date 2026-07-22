import { afterEach, describe, expect, test } from 'bun:test'
import { createServer, request as httpRequest, type Server } from 'node:http'
import { connect, createServer as createNetServer, type Server as NetServer } from 'node:net'
import { closeProxyFetchAgents, createProxyFetch } from '../server/utils/account-fetch'

const servers = new Set<NetServer>()

afterEach(async () => {
  await closeProxyFetchAgents()
  await Promise.all([...servers].map(server => new Promise<void>(resolve => {
    server.closeAllConnections?.()
    server.close(() => resolve())
  })))
  servers.clear()
})

async function listen(server: Server | NetServer) {
  servers.add(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as { port: number }).port
}

function createAuthenticatedSocks5Server(onAuthenticated: () => void) {
  return createNetServer((socket) => {
    let buffer = Buffer.alloc(0)
    let stage: 'greeting' | 'auth' | 'request' | 'tunnel' = 'greeting'

    const processBuffer = () => {
      while (stage !== 'tunnel') {
        if (stage === 'greeting') {
          if (buffer.length < 2 + (buffer[1] || 0)) return
          const length = 2 + buffer[1]!
          const methods = buffer.subarray(2, length)
          buffer = buffer.subarray(length)
          if (!methods.includes(2)) return socket.destroy()
          socket.write(Buffer.from([5, 2]))
          stage = 'auth'
          continue
        }

        if (stage === 'auth') {
          if (buffer.length < 2) return
          const usernameLength = buffer[1]!
          if (buffer.length < 2 + usernameLength + 1) return
          const passwordLength = buffer[2 + usernameLength]!
          const length = 3 + usernameLength + passwordLength
          if (buffer.length < length) return
          const username = buffer.subarray(2, 2 + usernameLength).toString()
          const password = buffer.subarray(3 + usernameLength, length).toString()
          buffer = buffer.subarray(length)
          if (username !== 'user' || password !== 'pass') return socket.destroy()
          onAuthenticated()
          socket.write(Buffer.from([1, 0]))
          stage = 'request'
          continue
        }

        if (buffer.length < 5) return
        const addressType = buffer[3]
        let host: string
        let addressLength: number
        if (addressType === 1) {
          addressLength = 4
          if (buffer.length < 4 + addressLength + 2) return
          host = [...buffer.subarray(4, 8)].join('.')
        } else if (addressType === 3) {
          addressLength = 1 + buffer[4]!
          if (buffer.length < 4 + addressLength + 2) return
          host = buffer.subarray(5, 5 + buffer[4]!).toString()
        } else {
          return socket.destroy()
        }
        const portOffset = 4 + addressLength
        const port = buffer.readUInt16BE(portOffset)
        buffer = buffer.subarray(portOffset + 2)
        stage = 'tunnel'
        const upstream = connect(port, host, () => {
          socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
          if (buffer.length) upstream.write(buffer)
          upstream.pipe(socket)
          socket.pipe(upstream)
        })
        upstream.on('error', () => socket.destroy())
      }
    }

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      processBuffer()
    })
  })
}

describe('account proxy transport', () => {
  test('tunnels fetch traffic through the configured authenticated HTTP proxy', async () => {
    const targetPort = await listen(createServer((_request, response) => response.end('proxied')))
    let connectCount = 0
    let proxyAuthorization: string | undefined
    const proxy = createServer((request, response) => {
      connectCount++
      proxyAuthorization = request.headers['proxy-authorization']
      const headers = { ...request.headers }
      delete headers['proxy-authorization']
      const upstream = httpRequest(request.url!, {
        method: request.method,
        headers
      }, upstreamResponse => {
        response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers)
        upstreamResponse.pipe(response)
      })
      upstream.on('error', () => response.destroy())
      request.pipe(upstream)
    })
    proxy.on('connect', (request, clientSocket, head) => {
      connectCount++
      proxyAuthorization = request.headers['proxy-authorization']
      const [host, port] = request.url!.split(':')
      const upstream = connect(Number(port), host, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length) upstream.write(head)
        upstream.pipe(clientSocket)
        clientSocket.pipe(upstream)
      })
      upstream.on('error', () => clientSocket.destroy())
    })
    const proxyPort = await listen(proxy)

    const fetchImpl = createProxyFetch(99, `http://user:pass@127.0.0.1:${proxyPort}`)
    const response = await fetchImpl(`http://127.0.0.1:${targetPort}/probe`)

    expect(await response.text()).toBe('proxied')
    expect(connectCount).toBe(1)
    expect(proxyAuthorization).toBe(`Basic ${btoa('user:pass')}`)
  })

  test('returns a web response after tunneling through authenticated SOCKS5', async () => {
    const targetPort = await listen(createServer((_request, response) => response.end('socks-proxied')))
    let authenticated = false
    const proxyPort = await listen(createAuthenticatedSocks5Server(() => {
      authenticated = true
    }))

    const fetchImpl = createProxyFetch(100, `socks5://user:pass@127.0.0.1:${proxyPort}`)
    const targetUrl = `http://127.0.0.1:${targetPort}/probe`
    const response = await fetchImpl(targetUrl)

    expect(authenticated).toBe(true)
    expect(response instanceof Response).toBe(true)
    expect(response.url).toBe(targetUrl)
    expect(typeof response.body?.getReader).toBe('function')
    expect(await response.text()).toBe('socks-proxied')
  })
})
