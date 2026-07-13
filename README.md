# OpenCode Manager

Nuxt UI 全栈号池管理：SQLite 存储账号，通过浏览器 Cookie 自动抓取 OpenCode SSR 页面解析 workspace / 用量。

## 功能

- Admin Key 登录（读取 `config.yaml`）
- 号池 CRUD：粘贴 auth cookie 自动同步
- 解析 workspace、邮箱、滚动/周/月用量、推荐码
- 单号刷新 / 全部刷新
- OpenAI 兼容的 `/v1/models`、`/v1/chat/completions`（支持流式透传）
- 默认轮询号池，上游报错时自动刷新额度并故障转移
- 额度耗尽自动禁用并在窗口释放后恢复，会员过期自动禁用
- 记录三个额度窗口的绝对刷新节点，按节点自动刷新
- 非会员筛选与批量删除
- 按滚动 $5、每周 $30、每月 $60 统计金额

## 配置

```yaml
# config.yaml
admin_key: "admin123"
api_keys:
  - "sk-ocm-your-client-key"
```

也可以登录后台后，在「API 密钥」页面创建或删除对外访问密钥。网页创建的密钥只在创建成功时显示一次，服务端仅保存 SHA-256 摘要。

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
- 可通过 `DATA_DIR` 环境变量修改数据目录（Docker 镜像默认为 `/app/data`）

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
| GET | `/api/api-keys` | 对外 API 密钥列表（仅显示掩码） |
| POST | `/api/api-keys` | 创建对外 API 密钥 |
| DELETE | `/api/api-keys/:id` | 删除网页创建的密钥 |
| DELETE | `/api/accounts/non-members` | 删除全部非会员账号 |
| GET | `/v1/models` | OpenAI 兼容模型列表 |
| POST | `/v1/chat/completions` | OpenAI 兼容聊天接口 |

OpenAI 客户端配置：

```text
Base URL: http://localhost:3000/v1
API Key: config.yaml 或网页创建的密钥
```

## Docker

镜像由 GitHub Actions 自动发布到 `ghcr.io/jellyfish-p/opencode-manager`。运行时挂载配置文件和数据目录：

```bash
docker run -d \
  --name opencode-manager \
  -p 3000:3000 \
  -v "$PWD/config.yaml:/app/config.yaml:ro" \
  -v "$PWD/data:/app/data" \
  ghcr.io/jellyfish-p/opencode-manager:latest
```

容器启动时会修复挂载数据目录的所有权，然后以非 root 的 `bun` 用户运行服务。若平台强制使用自定义非 root UID，请确保该 UID 对 `DATA_DIR` 有写权限。

推送到 `main` 会发布 `main`、`latest` 和提交 SHA 标签；推送 `v*` 标签会额外发布对应的语义版本标签。工作流也支持手动触发。amd64 与 arm64 镜像分别在 GitHub 原生架构 Runner 上构建，再合并为多架构 Manifest，不使用 QEMU；镜像安装、构建和运行均使用 Bun。
