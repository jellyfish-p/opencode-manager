export default defineEventHandler(async (event) => {
  requireAuth(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid account ID' })
  }
  const body = await readBody<{ rewardId?: unknown }>(event)
  const rewardId = typeof body.rewardId === 'string' ? body.rewardId.trim() : ''
  if (!rewardId) {
    throw createError({ statusCode: 400, statusMessage: 'rewardId is required' })
  }

  const result = await useAccountReferralReward(id, rewardId)
  return { ...result, account: toPublicAccount(result.account) }
})
