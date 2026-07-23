export default defineEventHandler((event) => {
  requireAuth(event)

  const operationId = getQuery(event).operationId
  if (
    typeof operationId !== 'string' ||
    !/^[A-Za-z0-9_-]{8,100}$/.test(operationId)
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid import operation id' })
  }

  return {
    progress: getAccountImportProgress(operationId)
  }
})
