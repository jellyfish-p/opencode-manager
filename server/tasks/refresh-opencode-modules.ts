export default defineTask({
  meta: {
    name: 'refresh-opencode-modules',
    description: 'Refresh the shared OpenCode route module cache'
  },
  async run() {
    const refreshed = await refreshOpenCodeRouteModuleCache()
    return {
      result: { refreshed }
    }
  }
})
