# Cloudflare Workers 部署

BioTrip 通过 vinext 部署到 Cloudflare Workers，D1 保存账号、旅程和反馈，Workflows 执行后台规划。它需要服务端运行时。

## 部署资源

| 资源 | 绑定或入口 |
| --- | --- |
| Worker | `biotrip` |
| D1 | `BIOTRIP_DB` |
| Workflow | `BIOTRIP_PLANNING` |
| 静态资源 | `ASSETS` |
| 产品首页 | `/` |
| 应用 | `/app` |
| WHOOP 回调 | `/api/whoop/callback` |

配置源为 [`wrangler.jsonc`](../wrangler.jsonc)。独立部署时，替换域名、数据库和各服务的资源标识，保留代码使用的绑定名称。

## 本地开发

```bash
pnpm install --frozen-lockfile
cp .env.example .dev.vars
# 填写自己的本地服务配置
pnpm exec wrangler d1 migrations apply biotrip-users --local
pnpm dev:vinext
```

开发服务位于 `http://localhost:3001`。WHOOP 本地回调必须与平台登记的地址和端口一致。

## 生产配置

通过 `pnpm exec wrangler login` 登录自己的 Cloudflare 账号。生产密钥使用 Worker Secrets，非敏感资源标识与域名配置写入 Wrangler 配置。

需要配置的密钥包括 `AUTH_SECRET`、`BAILIAN_API_KEY`、`FLYAI_API_KEY`、`FLYAI_SIGN_SECRET`、`RESEND_API_KEY`，以及启用 WHOOP 时的 `WHOOP_CLIENT_SECRET` 和 `WHOOP_COOKIE_SECRET`。模型 API 可使用独立的 `BAILIAN_MODEL_API_KEY`。

服务接入见 [配置清单](platform-access-checklist.md)。WHOOP 的回调地址、邮件发信域、FlyAI Skill 网关域名和 Vault 出网范围应与实际域名一致。

## 检查、迁移与发布

```bash
pnpm exec tsc --noEmit
pnpm test
pnpm lint
pnpm run build:vinext
```

发布前备份已有生产数据，并检查需要应用的迁移：

```bash
pnpm exec wrangler d1 migrations list biotrip-users --remote
pnpm exec wrangler d1 migrations apply biotrip-users --remote
pnpm run deploy:vinext
```

部署命令使用构建生成的 `dist/server/wrangler.json`，并合并根目录配置。更改绑定后运行 `pnpm exec wrangler types` 更新类型。

首次部署应配置自己的 Custom Domain，验证 HTTPS、邮箱登录、数据库和后台任务。更新已有服务时，保留所需的密钥、D1、Workflow 与定时任务绑定。

## 发布后验证

检查首页、`/app`、登录、隐私、素材来源和影片入口。验证匿名请求不能访问受保护的任务与会话，再用独立账号完成登录、规划、确认和反馈。

影片 `/api/film/v3` 支持 HTTP Range。更换影片时需要同步版本与固定资源长度，避免播放器拖动失效。公网影片和截图是产品展示素材，不包含本地视频制作工程。

当前验证范围见 [验证说明](verification.md)。
