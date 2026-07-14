import { describe, expect, test } from 'bun:test'
import { resolveRefreshedAccountEmail } from '../server/utils/account-identity'

describe('account identity refresh', () => {
  test('preserves the known email when a refresh cannot parse it', () => {
    expect(resolveRefreshedAccountEmail(null, 'known@example.com')).toBe('known@example.com')
  })

  test('uses a newly parsed email when one is available', () => {
    expect(resolveRefreshedAccountEmail('new@example.com', 'known@example.com')).toBe('new@example.com')
  })
})
