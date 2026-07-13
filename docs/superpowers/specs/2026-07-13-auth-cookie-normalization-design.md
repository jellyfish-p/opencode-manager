# Auth Cookie 规范化设计

## 背景

账号表当前通过 `auth_cookie` 字段保存 OpenCode 登录凭据。实际数据可能是两种格式：

1. 仅保存 `auth` Cookie 的值，例如 `Fe26.2...`。
2. 保存旧版完整 Cookie 字符串，例如 `auth=Fe26.2...; other=value`。

当前请求代码直接把字段内容作为 Cookie 头发送。纯值不符合 `name=value` 格式，因此 OpenCode 将请求重定向到 `/auth/authorize`，无法得到 workspace ID。

## 目标行为

服务端从数据库读取 `auth_cookie` 后，将其规范化为：

```text
auth=<auth-value>; oc_locale=zh
```

兼容以下输入：

- 纯 auth 值：直接用作 `<auth-value>`。
- 完整 Cookie：从中提取名为 `auth` 的 Cookie 值，忽略其他 Cookie 和已有的 `oc_locale`。

## 边界与错误处理

- 去除输入及 Cookie 名称、值两侧的空白。
- 输入为空时抛出明确错误。
- 输入看起来是完整 Cookie（包含 `=`），但不存在 `auth` 项时抛出明确错误，避免把错误字段静默当作 auth 值。
- `auth` 值为空时抛出明确错误。
- 不修改数据库结构，不迁移现有记录。
- 不记录或回传 auth 值。

## 代码结构

在 `server/utils/opencode.ts` 中将现有 Cookie 规范化逻辑调整为一个可独立测试的函数。`fetchOpenCodeAccount` 继续从数据库记录接收 `auth_cookie`，并使用该函数生成 `/auth` 和 workspace 页面请求共用的 Cookie 头。

其余请求头、重定向处理和 workspace ID 解析保持不变。

## 测试

新增单元测试覆盖：

1. 纯 auth 值生成 `auth=<value>; oc_locale=zh`。
2. 完整 Cookie 提取 `auth` 并生成相同格式。
3. 完整 Cookie 缺少 `auth` 时抛错。
4. 空 auth 值时抛错。

先运行测试确认现有实现失败，再进行最小修改使测试通过。最后运行 Cookie 单元测试、现有 SSR 鉴权回归测试和 Nuxt 生产构建。
