import { ProxyAgent, fetch as undiciFetch } from 'undici'
import type { Account } from './db'
import { getIpPoolEntry } from './ip-pool'

const proxyAgents = new Map<number, { proxyUrl: string; agent: ProxyAgent }>()

function fetchThroughProxy(proxyId: number, proxyUrl: string): typeof fetch {
  if (typeof Bun !== 'undefined') {
    return ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      fetch(input, { ...(init as any), proxy: proxyUrl })
    ) as typeof fetch
  }

  let cached = proxyAgents.get(proxyId)
  if (!cached || cached.proxyUrl !== proxyUrl) {
    if (cached) void cached.agent.close().catch(() => {})
    cached = { proxyUrl, agent: new ProxyAgent(proxyUrl) }
    proxyAgents.set(proxyId, cached)
  }
  const agent = cached.agent
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    undiciFetch(input as any, { ...(init as any), dispatcher: agent }) as unknown as Promise<Response>
  ) as typeof fetch
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
  const agents = [...proxyAgents.values()]
  proxyAgents.clear()
  await Promise.all(agents.map(({ agent }) => agent.close()))
}
