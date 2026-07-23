export default defineEventHandler((event) => {
  requireAuth(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid account ID' })
  }
  if (!getAccount(id)) {
    throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  }

  const cached = getCachedReferralRewards(id)
  return {
    cached: Boolean(cached),
    rewardIds: cached?.rewardIds ?? [],
    usedRewardIds: cached?.usedRewardIds ?? [],
    refreshedAt: cached ? new Date(cached.refreshedAt).toISOString() : null
  }
})
