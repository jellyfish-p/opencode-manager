export default defineEventHandler(async (event) => {
  requireApiKey(event)
  return proxyModels(event)
})
