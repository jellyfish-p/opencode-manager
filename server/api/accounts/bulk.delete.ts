export default defineEventHandler(async (event) => {
  requireAuth(event)

  const body = await readBody<{ ids?: unknown }>(event)
  const ids = parseAccountIds(body?.ids)
  const missingIds = ids.filter(id => !getAccount(id))
  if (missingIds.length) {
    throw createError({
      statusCode: 404,
      statusMessage: `Account not found: ${missingIds.join(', ')}`
    })
  }

  let deleted = 0
  for (const id of ids) {
    deleted += deleteAccount(id).changes
    removeAccountPollSchedule(id)
  }

  return { ok: true, deleted }
})

function parseAccountIds(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'ids is required' })
  }
  if (value.length > 1000 || value.some(id => !Number.isSafeInteger(id) || Number(id) <= 0)) {
    throw createError({ statusCode: 400, statusMessage: 'ids must contain valid account IDs' })
  }
  return [...new Set(value as number[])]
}
