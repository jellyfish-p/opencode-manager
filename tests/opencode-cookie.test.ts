import { expect, test } from 'bun:test'
import { buildAuthCookie } from '../server/utils/opencode'

test('builds the Cookie header from a raw auth value', () => {
  expect(buildAuthCookie('Fe26.2**token')).toBe('auth=Fe26.2**token; oc_locale=zh')
})

test('extracts auth from a legacy full Cookie string', () => {
  expect(buildAuthCookie('other=value; auth=Fe26.2**token; oc_locale=en'))
    .toBe('auth=Fe26.2**token; oc_locale=zh')
})

test('rejects a full Cookie string without auth', () => {
  expect(() => buildAuthCookie('session=value; oc_locale=en'))
    .toThrow('auth cookie is missing')
})

test('rejects an empty auth value', () => {
  expect(() => buildAuthCookie('auth= ; other=value'))
    .toThrow('auth cookie value is required')
})
