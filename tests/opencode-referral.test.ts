import { beforeEach, describe, expect, test } from 'bun:test'
import {
  applyOpenCodeReferralReward,
  cancelOpenCodeSubscriptionRenewal,
  clearOpenCodeRouteModuleCache,
  discoverBillingPortalServerId,
  discoverReferralApplyServerId,
  parseOpenCodeHydration,
  refreshOpenCodeRouteModuleCache,
  serializeOpenCodeServerArgs
} from '../server/utils/opencode'

describe('OpenCode referral rewards', () => {
  beforeEach(() => {
    clearOpenCodeRouteModuleCache()
  })

  test('separates available and used rewards from SSR hydration', () => {
    const html = `
      referralCode:"HMVSC7SZVQ",hasReferral:!0,rewards:$R[1]=[
        $R[2]={id:"ref_APPLIED1",source:"inviter",status:"applied",amount:500},
        $R[3]={id:"ref_AVAILABLE2",source:"invitee",status:"available",amount:500}
      ],liteSubscriptionID:"sub_LITE"
    `

    const info = parseOpenCodeHydration(html)
    expect(info.referralCode).toBe('HMVSC7SZVQ')
    expect(info.availableReferralRewardIds).toEqual(['ref_AVAILABLE2'])
    expect(info.usedReferralRewardIds).toEqual(['ref_APPLIED1'])
    expect(info.liteSubscriptionId).toBe('sub_LITE')
  })

  test('discovers the billing portal action ID', async () => {
    const portalId = 'b'.repeat(64)
    const html = '<link href="/_build/assets/billing.js" rel="modulepreload">'
    const fakeFetch = (async () => new Response(`
      const createSessionUrl_action = createServerReference("${portalId}");
      const createSessionUrl = action(createSessionUrl_action, "liteSessionUrl");
    `)) as typeof fetch

    expect(await discoverBillingPortalServerId(html, fakeFetch)).toBe(portalId)
  })

  test('discovers the apply action ID from the current route bundle', async () => {
    const applyId = 'f386778c1b78eade3e6acff87c9284e02fcd86826463c080526143c4fe8fff23'
    const html = '<link href="/_build/assets/index.js" rel="modulepreload">'
    const fakeFetch = (async () => new Response(`
      const applyGoReferralReward_action = createServerReference("${applyId}");
      const applyGoReferralReward = action(applyGoReferralReward_action, "go.referral.reward.apply");
    `)) as typeof fetch

    expect(await discoverReferralApplyServerId(html, fakeFetch)).toBe(applyId)
  })

  test('checks the route action bundle before unrelated module preloads', async () => {
    const applyId = 'a'.repeat(64)
    const calls: string[] = []
    const html = `
      <link href="/_build/assets/runtime.js" rel="modulepreload">
      <link href="/_build/assets/action-route.js" rel="modulepreload">
    `
    const fakeFetch = (async (input: string | URL | Request) => {
      const url = String(input)
      calls.push(url)
      return new Response(
        url.endsWith('/action-route.js')
          ? `createServerReference("${applyId}");"go.referral.reward.apply"`
          : 'const runtime = true'
      )
    }) as typeof fetch

    expect(await discoverReferralApplyServerId(html, fakeFetch)).toBe(applyId)
    expect(calls).toEqual(['https://opencode.ai/_build/assets/action-route.js'])
  })

  test('shares the cached route module across accounts', async () => {
    const applyId = 'c'.repeat(64)
    const html = '<link href="/_build/assets/shared-action.js" rel="modulepreload">'
    let fetches = 0
    const fakeFetch = (async () => {
      fetches++
      return new Response(
        `createServerReference("${applyId}");"go.referral.reward.apply"`
      )
    }) as typeof fetch

    expect(await discoverReferralApplyServerId(html, fakeFetch)).toBe(applyId)
    expect(await discoverReferralApplyServerId(html, fakeFetch)).toBe(applyId)
    expect(fetches).toBe(1)
  })

  test('periodically refreshes the shared route module cache', async () => {
    const firstId = 'd'.repeat(64)
    const refreshedId = 'e'.repeat(64)
    const html = '<link href="/_build/assets/refreshable-action.js" rel="modulepreload">'
    let fetches = 0
    const fakeFetch = (async () => {
      fetches++
      const id = fetches === 1 ? firstId : refreshedId
      return new Response(
        `createServerReference("${id}");"go.referral.reward.apply"`
      )
    }) as typeof fetch

    expect(await discoverReferralApplyServerId(html, fakeFetch)).toBe(firstId)
    expect(await refreshOpenCodeRouteModuleCache(fakeFetch)).toBe(true)
    expect(await discoverReferralApplyServerId(html, fakeFetch)).toBe(refreshedId)
    expect(fetches).toBe(2)
  })

  test('keeps the last successful modules when a scheduled refresh fails', async () => {
    const applyId = 'f'.repeat(64)
    const html = '<link href="/_build/assets/resilient-action.js" rel="modulepreload">'
    let fail = false
    const fakeFetch = (async () => {
      if (fail) throw new Error('temporary module outage')
      return new Response(
        `createServerReference("${applyId}");"go.referral.reward.apply"`
      )
    }) as typeof fetch

    expect(await discoverReferralApplyServerId(html, fakeFetch)).toBe(applyId)
    fail = true
    expect(await refreshOpenCodeRouteModuleCache(fakeFetch)).toBe(false)
    expect(await discoverReferralApplyServerId(html, fakeFetch)).toBe(applyId)
  })

  test('serializes and posts action arguments using the SolidStart server protocol', async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = []
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ input: String(input), init })
      return new Response('ok')
    }) as typeof fetch

    await applyOpenCodeReferralReward(
      'test-cookie',
      'wrk_TEST',
      'ref_TEST',
      'a'.repeat(64),
      fakeFetch
    )

    expect(requests).toHaveLength(1)
    expect(requests[0]!.input).toBe('https://opencode.ai/_server')
    expect(requests[0]!.init?.method).toBe('POST')
    const headers = new Headers(requests[0]!.init?.headers)
    expect(headers.get('cookie')).toBe('auth=test-cookie; oc_locale=zh')
    expect(headers.get('x-server-id')).toBe('a'.repeat(64))
    expect(headers.get('x-server-instance')).toBe('server-fn:0')
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual(
      serializeOpenCodeServerArgs(['wrk_TEST', 'ref_TEST'])
    )
  })

  test('cancels renewal through Stripe Portal and verifies period-end cancellation', async () => {
    let subscriptionReads = 0
    let cancelRequests = 0
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url === 'https://opencode.ai/_server') {
        return new Response(';data:"https://billing.stripe.com/p/session/live_testtoken"')
      }
      if (url === 'https://billing.stripe.com/p/session/live_testtoken') {
        return new Response(`
          <script type="application/json" id="preloaded_json">
            {&quot;session_api_key&quot;:&quot;ek_test_key&quot;,&quot;portal_session_id&quot;:&quot;bps_test&quot;}
          </script>
        `)
      }
      if (url.endsWith('/subscriptions/sub_LITE/cancel')) {
        cancelRequests++
        expect(init?.method).toBe('POST')
        return Response.json({ id: 'sub_LITE' })
      }
      if (url.endsWith('/subscriptions/sub_LITE')) {
        subscriptionReads++
        return Response.json({
          id: 'sub_LITE',
          cancel_at_period_end: subscriptionReads > 1,
          current_period_end: 1_800_000_000
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    }) as typeof fetch

    const result = await cancelOpenCodeSubscriptionRenewal(
      'test-cookie',
      'wrk_TEST',
      'sub_LITE',
      'c'.repeat(64),
      fakeFetch
    )

    expect(result.alreadyCancelled).toBe(false)
    expect(result.currentPeriodEnd).toBe('2027-01-15T08:00:00.000Z')
    expect(cancelRequests).toBe(1)
    expect(subscriptionReads).toBe(2)
  })
})
