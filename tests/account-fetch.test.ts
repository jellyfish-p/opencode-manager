import { afterEach, describe, expect, test } from 'bun:test'
import { createServer, request as httpRequest, type Server } from 'node:http'
import { connect } from 'node:net'
import { closeProxyFetchAgents, createProxyFetch } from '../server/utils/account-fetch'

const servers = new Set<Server>()

afterEach(async () => {
  await closeProxyFetchAgents()
  await Promise.all([...servers].map(server => new Promise<void>(resolve => {
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
})
