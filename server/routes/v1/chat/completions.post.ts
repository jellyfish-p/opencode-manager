export default defineEventHandler(async (event) => {
  requireApiKey(event)
  return proxyChatCompletions(event)
})
