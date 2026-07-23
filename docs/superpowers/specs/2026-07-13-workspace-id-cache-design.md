# Workspace ID 缓存复用设计

## 背景

账号刷新成功后，现有代码已经把解析到的 workspace ID 写入 `accounts.workspace_id`。但后续每次刷新仍先请求 `/auth` 解析 workspace ID，没有使用数据库中的缓存，增加了一次不必要的远程请求。

## 目标

- 首次刷新时通过 `/auth` 获取 workspace ID，并通过现有账号更新流程保存到数据库。
- 后续刷新优先使用数据库中的 `workspace_id` 直接加载 workspace 页面。
- 已有 workspace ID 的刷新失败时直接返回错误，不再自动回退到 `/auth` 重定向链。
- 所有 OpenCode 上游请求必须设置硬超时，避免账号操作队列永久等待。
- 不修改数据库结构。

## 数据流

`refreshAccount` 读取完整账号记录，并把 `account.auth_cookie` 与 `account.workspace_id` 一起传给 `fetchOpenCodeAccount`。

当存在缓存 ID 时：

1. 请求 `/workspace/{cachedWorkspaceId}/go`。
2. 如果请求成功且页面包含可解析的账号数据，返回结果，并保留该 workspace ID。
3. 如果请求失败、超时、最终 URL 已跳出 workspace 路径，或页面无法解析账号数据，则直接结束本次刷新并记录错误，不再请求 `/auth`。

当不存在缓存 ID 时，首次刷新才通过 `/auth` 获取 workspace ID，然后加载 workspace 页面并持久化该 ID。

`refreshAccount` 继续使用现有 `updateAccount` 调用保存 `info.workspaceId`。因此首次得到的 ID 会写入数据库，缓存失效后得到的新 ID 也会覆盖旧值。

## 组件边界

- `server/utils/accounts.ts`：负责从数据库记录取出缓存 ID，并把最终账号信息持久化。
- `server/utils/opencode.ts`：负责缓存优先的远程请求、缓存失效判定、workspace ID 重新解析和页面数据解析。
- `server/utils/db.ts`：保持现有 `workspace_id` 字段和更新逻辑，不做 schema 迁移。

远程请求逻辑应拆成小型内部函数，使“解析 ID”和“加载 workspace 页面”各自只有一个职责。测试可替换全局 `fetch`，避免访问真实 OpenCode 服务或泄露凭据。

## 成功与失效判定

workspace 页面同时满足以下条件才算成功：

- HTTP 响应状态为成功。
- 跟随重定向后的最终 URL 仍位于 `/workspace/` 路径。
- hydration HTML 在补入回退 ID 之前已解析出 workspace ID 或邮箱等账号标识。

不能先把缓存 ID 写入解析结果再判断页面是否有效，否则登录页也可能因为人工补入的 ID 被误判为成功。

workspace 页面失败时，保留现有错误处理：账号状态更新为 `error`，并把不含 Cookie 的错误信息写入 `last_error`。

刷新页面包含推荐奖励或订阅信息时，只从 modulepreload 列表尾部开始查找实际包含服务端动作 ID 的路由模块，命中后停止；不再并发下载全部前端模块。路由模块缓存由所有账号共享，每 15 分钟后台刷新一次；刷新失败时继续使用上一次成功结果。已有上游 API Key 时也不重复请求 `/keys`。

## 兼容性与安全

- `fetchOpenCodeAccount(authCookie, cachedWorkspaceId?)` 的第二个参数可选，旧调用仍可使用首次解析流程。
- Cookie 继续通过 `buildAuthCookie` 生成，不改变 auth 兼容逻辑。
- 日志、错误信息和 API 响应不得包含 auth Cookie。
- 缓存只减少 `/auth` 请求，不改变定时刷新、手动刷新或批量刷新行为。

## 测试

使用可控的 fetch 替身覆盖以下行为：

1. 无缓存时请求 `/auth`，解析 ID 并返回该 ID，供现有持久化流程保存。
2. 有有效缓存时只请求 workspace 页面，不请求 `/auth`。
3. 缓存页面跳转到登录路径或无法解析时直接失败，并确认没有请求 `/auth`。
4. workspace 与 API Key 请求都携带中止期限。
5. 路由动作模块命中后停止扫描无关 modulepreload。

最后运行新增单元测试、现有 Cookie 测试、SSR 鉴权回归测试和 Nuxt 生产构建。
