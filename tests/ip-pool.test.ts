import { describe, expect, test } from 'bun:test'
import {
  normalizeProxyUrl,
  planStableIpAssignments,
  redactProxyUrl
} from '../server/utils/ip-pool'

describe('IP pool proxy URLs', () => {
  test('normalizes common proxy list formats', () => {
    expect(normalizeProxyUrl('1.2.3.4:8080')).toBe('http://1.2.3.4:8080/')
    expect(normalizeProxyUrl('user:pass@1.2.3.4:8080')).toBe(
      'http://user:pass@1.2.3.4:8080/'
    )
    expect(normalizeProxyUrl('1.2.3.4:8080:user:pass')).toBe(
      'http://user:pass@1.2.3.4:8080/'
    )
    expect(normalizeProxyUrl('sk5://user:pass@1.2.3.4:1080')).toBe(
      'socks5://user:pass@1.2.3.4:1080'
    )
    expect(normalizeProxyUrl('socks5h://1.2.3.4:1080')).toBe(
      'socks5h://1.2.3.4:1080'
    )
  })

  test('never exposes proxy passwords in public data', () => {
    expect(redactProxyUrl('http://user:secret@1.2.3.4:8080/')).toBe(
      'http://user:***@1.2.3.4:8080/'
    )
  })
})

describe('stable chunk assignment', () => {
  test('keeps existing assignments and fills the least loaded proxy by chunks', () => {
    const changes = planStableIpAssignments(
      [
        { id: 1, ip_pool_id: 1 },
        { id: 2, ip_pool_id: 1 },
        { id: 3, ip_pool_id: null },
        { id: 4, ip_pool_id: null },
        { id: 5, ip_pool_id: null }
      ],
      [{ id: 1, enabled: 1 }, { id: 2, enabled: 1 }],
      2
    )

    expect(changes).toEqual([
      { accountId: 3, ipPoolId: 2 },
      { accountId: 4, ipPoolId: 2 },
      { accountId: 5, ipPoolId: 1 }
    ])
  })

  test('moves only accounts whose proxy is no longer enabled', () => {
    const changes = planStableIpAssignments(
      [
        { id: 1, ip_pool_id: 1 },
        { id: 2, ip_pool_id: 1 },
        { id: 3, ip_pool_id: 2 },
        { id: 4, ip_pool_id: 2 }
      ],
      [{ id: 1, enabled: 0 }, { id: 2, enabled: 1 }, { id: 3, enabled: 1 }],
      2
    )

    expect(changes).toEqual([
      { accountId: 1, ipPoolId: 3 },
      { accountId: 2, ipPoolId: 3 }
    ])
  })

  test('falls back to direct mode when there are no enabled proxies', () => {
    expect(planStableIpAssignments(
      [{ id: 1, ip_pool_id: 1 }, { id: 2, ip_pool_id: null }],
      [{ id: 1, enabled: 0 }],
      5
    )).toEqual([{ accountId: 1, ipPoolId: null }])
  })
})
