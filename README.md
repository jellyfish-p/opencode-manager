# OpenCode Manager

Nuxt UI 全栈号池管理：SQLite 存储账号，通过浏览器 Cookie 自动抓取 OpenCode SSR 页面解析 workspace / 用量。

## 功能

- Admin Key 登录（读取 `config.yaml`）
- 号池 CRUD：粘贴 auth cookie 自动同步
- 解析 workspace、邮箱、滚动/周/月用量、推荐码
- 单号刷新 / 全部刷新
- 定时任务每 5 分钟自动刷新（Nitro tasks）

## 配置

```yaml
# config.yaml
admin_key: "admin123"
```

## 开发

```bash
bun install
bun run dev
```

打开 http://localhost:3000 ，使用 `admin_key` 登录。

## 添加账号

1. 浏览器登录 https://opencode.ai
2. DevTools → Network → 任意请求 → 复制 `Cookie`
3. 后台「号池」→ 添加账号 → 粘贴 Cookie

系统流程：

1. `GET https://opencode.ai/auth`（携带 Cookie）→ `Location: /workspace/wrk_xxx`
2. `GET /workspace/{id}/go` → 解析 SSR hydration 数据

## 数据

- SQLite: `data/opencode.db`
- Cookie 仅存服务端，API 不回传 `auth_cookie`

## API

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/auth/login` | `{ key }` |
| POST | `/api/auth/logout` | 退出 |
| GET | `/api/auth/me` | 会话检查 |
| GET | `/api/accounts` | 列表 |
| POST | `/api/accounts` | `{ name?, auth_cookie }` |
| PATCH | `/api/accounts/:id` | 更新 |
| DELETE | `/api/accounts/:id` | 删除 |
| POST | `/api/accounts/:id/refresh` | 刷新单号 |
| POST | `/api/accounts/refresh-all` | 刷新全部 |
| GET | `/api/stats` | 统计 |
