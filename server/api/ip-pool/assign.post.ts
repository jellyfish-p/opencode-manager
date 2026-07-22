export default defineEventHandler((event) => {
  requireAuth(event)
  const changes = ensureStableIpAssignments()
  return {
    changed: changes.length,
    assigned: changes.filter(change => change.ipPoolId !== null).length,
    unassigned: changes.filter(change => change.ipPoolId === null).length
  }
})
