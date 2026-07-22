import { SocksClient, type SocksProxy } from 'socks'
import {
  Agent,
  ProxyAgent,
  buildConnector,
  fetch as undiciFetch,
  type Dispatcher
} from 'undici-client'
import type { Account } from './db'
import { getIpPoolEntry } from './ip-pool'

interface ProxyTransport {
  proxyUrl: string
  fetch: typeof fetch
  close: () => void | Promise<void>
}

const proxyTransports = new Map<number, ProxyTransport>()

function isSocksProxy(proxyUrl: string) {
  return ['socks5:', 'socks5h:'].includes(new URL(proxyUrl).protocol)
}

function decodeCredential(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function proxyFetch(dispatcher: Dispatcher): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const source = await undiciFetch(input as any, { ...(init as any), dispatcher })
    const response = new Response(source.body as unknown as ReadableStream<Uint8Array> | null, {
      status: source.status,
      statusText: source.statusText,
      headers: source.headers as unknown as HeadersInit
    })
    Object.defineProperties(response, {
      url: { configurable: true, value: source.url },
      redirected: { configurable: true, value: source.redirected }
    })
    return response
  }) as typeof fetch
}

function createSocksConnector(proxyUrl: string): ReturnType<typeof buildConnector> {
  const url = new URL(proxyUrl)
  const proxy: SocksProxy = {
    host: url.hostname.replace(/^\[(.*)\]$/, '$1'),
    port: Number(url.port),
    type: 5,
    userId: url.username ? decodeCredential(url.username) : undefined,
    password: url.password ? decodeCredential(url.password) : undefined
  }
  const upgradeTls = buildConnector({})

  return async (options, callback) => {
    try {
      const { socket } = await SocksClient.createConnection({
        command: 'connect',
        proxy,
        timeout: 10_000,
        destination: {
          host: options.hostname,
          port: options.port ? Number(options.port) : options.protocol === 'http:' ? 80 : 443
        }
      })
      if (options.protocol !== 'https:') {
        callback(null, socket.setNoDelay())
        return
      }
      upgradeTls({ ...options, httpSocket: socket }, callback)
    } catch (error) {
      callback(error as Error, null)
    }
  }
}

function createSocksTransport(proxyUrl: string): ProxyTransport {
  const agent = new Agent({ connect: createSocksConnector(proxyUrl) })
  return {
    proxyUrl,
    fetch: proxyFetch(agent),
    close: () => agent.close()
  }
}

function createHttpTransport(proxyUrl: string): ProxyTransport {
  if (typeof Bun !== 'undefined') {
    return {
      proxyUrl,
      fetch: ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        fetch(input, { ...(init as any), proxy: proxyUrl })
      ) as typeof fetch,
      close: () => {}
    }
  }

  const agent = new ProxyAgent(proxyUrl)
  return {
    proxyUrl,
    fetch: proxyFetch(agent),
    close: () => agent.close()
  }
}

function buildProxyTransport(proxyUrl: string) {
  return isSocksProxy(proxyUrl)
    ? createSocksTransport(proxyUrl)
    : createHttpTransport(proxyUrl)
}

function fetchThroughProxy(proxyId: number, proxyUrl: string): typeof fetch {
  let transport = proxyTransports.get(proxyId)
  if (!transport || transport.proxyUrl !== proxyUrl) {
    if (transport) void Promise.resolve(transport.close()).catch(() => {})
    transport = buildProxyTransport(proxyUrl)
    proxyTransports.set(proxyId, transport)
  }
  return transport.fetch
}

export function createProxyFetch(proxyId: number, proxyUrl: string) {
  return fetchThroughProxy(proxyId, proxyUrl)
}

export function createAccountFetch(account: Pick<Account, 'ip_pool_id'>): typeof fetch {
  if (account.ip_pool_id === null) return fetch
  const entry = getIpPoolEntry(account.ip_pool_id)
  if (!entry || !entry.enabled) {
    throw new Error('The account has no available outbound proxy')
  }
  return fetchThroughProxy(entry.id, entry.proxy_url)
}

export async function closeProxyFetchAgents() {
  const transports = [...proxyTransports.values()]
  proxyTransports.clear()
  await Promise.all(transports.map(transport => transport.close()))
}
