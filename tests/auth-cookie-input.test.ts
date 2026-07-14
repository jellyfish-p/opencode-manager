import { describe, expect, test } from 'bun:test'
import {
  normalizeStoredAuthCookieValue,
  parseAuthCookieValueLines,
  validateAuthCookieValue
} from '../server/utils/auth-cookie'

describe('auth cookie value input', () => {
  test('splits non-empty lines and removes duplicates', () => {
    expect(parseAuthCookieValueLines('token-A\r\n\n token-B== \ntoken-A')).toEqual([
      'token-A',
      'token-B=='
    ])
  })

  test('rejects cookie pairs in a batch', () => {
    expect(() => parseAuthCookieValueLines('token-A\nauth=token-B'))
      .toThrow('line 2: only the raw auth cookie value is accepted')
  })

  test('validates one raw value without extracting cookie pairs', () => {
    expect(validateAuthCookieValue(' token-A ')).toBe('token-A')
    expect(validateAuthCookieValue('raw-token==')).toBe('raw-token==')
    expect(() => validateAuthCookieValue('auth=token-A'))
      .toThrow('only the raw auth cookie value is accepted')
  })

  test('normalizes legacy database cookies without changing raw padded values', () => {
    expect(normalizeStoredAuthCookieValue('other=x; auth=legacy-token; oc_locale=en'))
      .toBe('legacy-token')
    expect(normalizeStoredAuthCookieValue('auth=legacy-token')).toBe('legacy-token')
    expect(normalizeStoredAuthCookieValue('raw-token==')).toBe('raw-token==')
  })
})
