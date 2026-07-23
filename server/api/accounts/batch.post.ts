export default defineEventHandler(async (event) => {
  requireAuth(event)

  const body = await readBody<{
    name?: string
    auth_cookie_values?: unknown
    refresh?: boolean
    operation_id?: unknown
  }>(event)

  const operationId = typeof body?.operation_id === 'string'
    ? body.operation_id
    : null
  if (operationId && !/^[A-Za-z0-9_-]{8,100}$/.test(operationId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid import operation id' })
  }
  const progress = operationId
    ? beginAccountImportProgress(operationId)
    : null

  try {
    let authCookieValues: string[]
    try {
      if (typeof body?.auth_cookie_values !== 'string') {
        throw new Error('auth_cookie_values is required')
      }
      authCookieValues = parseAuthCookieValueLines(body.auth_cookie_values)
    } catch (error) {
      throw createError({
        statusCode: 400,
        statusMessage: error instanceof Error ? error.message : 'Invalid auth cookie values'
      })
    }

    progress?.update('creating', '正在创建初始账号记录')
    const created = authCookieValues.map((authCookie, index) => createAccount({
      name: body.name
        ? authCookieValues.length === 1
          ? body.name
          : `${body.name} ${index + 1}`
        : undefined,
      auth_cookie: authCookie
    }))
    ensureStableIpAssignments()
    const assignedCreated = created.map(account => getAccount(account.id)!)
    progress?.setAccountIds(assignedCreated.map(account => account.id))

    progress?.update('workspaces', '正在发现 Cookie 对应的 workspace')
    const expanded = body.refresh === false
      ? assignedCreated
      : await expandAccountWorkspacesByIds(assignedCreated.map(account => account.id))
    progress?.setAccountIds(expanded.map(account => account.id))

    progress?.update('refreshing', `正在同步 ${expanded.length} 个 workspace 账号`)
    const accounts = body.refresh === false
      ? expanded
      : await refreshAccountsByIds(expanded.map(account => account.id))
    if (body.refresh === false) {
      for (const account of accounts) updateAccountPollSchedule(account)
    }

    progress?.update('finalizing', '正在汇总账号同步结果')
    const failed = body.refresh === false
      ? 0
      : accounts.filter(account => account.status === 'error').length
    const result = {
      created: accounts.length,
      synchronized: body.refresh === false ? 0 : accounts.length - failed,
      failed,
      accounts: accounts.map(toPublicAccount)
    }
    progress?.complete()
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Account import failed'
    progress?.fail(message)
    throw error
  }
})
