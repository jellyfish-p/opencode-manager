import { expect, test } from 'bun:test'
import { buildAuthCookie } from '../server/utils/opencode'

test('builds the Cookie header from a raw auth value', () => {
  expect(buildAuthCookie('Fe26.2**token')).toBe('auth=Fe26.2**token; oc_locale=zh')
  expect(buildAuthCookie('padded-token==')).toBe('auth=padded-token==; oc_locale=zh')
})

test('rejects an auth cookie pair instead of extracting its value', () => {
  expect(() => buildAuthCookie('auth=Fe26.2**token'))
    .toThrow('only the raw auth cookie value is accepted')
})

test('rejects a full Cookie string instead of extracting auth', () => {
  expect(() => buildAuthCookie('other=value; auth=Fe26.2**token; oc_locale=en'))
    .toThrow('only the raw auth cookie value is accepted')
})

test('rejects an empty auth value', () => {
  expect(() => buildAuthCookie('   '))
    .toThrow('auth cookie value is required')
})
