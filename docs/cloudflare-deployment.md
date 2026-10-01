# Cloudflare Workers 部署

## 当前配置

- Worker 名称：`biotrip`
- 生产域名：`https://biotrip.ccwu.cc`
- WHOOP OAuth callback：`https://biotrip.ccwu.cc/api/whoop/callback`
- 配置源：[wrangler.jsonc](../wrangler.jsonc)
- 应用通过 vinext 部署为 Cloudflare Worker；动态 API 使用服务端运行时，不是静态 Pages 导出。
- 关闭 vinext 响应缓存、KV 数据缓存和图片优化，避免引入目前不需要的持久缓存或外部图像服务。

Cloudflare 中 `biotrip.ccwu.cc` 区域已启用。Worker 使用 Custom Domain，生产域名已正常解析并提供 HTTPS；不要添加同名 CNAME。

## 本地构建与部署

```bash
pnpm install
pnpm run build:vinext
pnpm run deploy:vinext
```

`pnpm run deploy:vinext` 使用构建生成的 `dist/server/wrangler.json`，该文件会合并根目录 `wrangler.jsonc` 中的域名和变量配置。更新 Wrangler 配置后运行 `pnpm exec wrangler types`。

Cloudflare 账号认证使用 `pnpm exec wrangler login`。当前 OAuth 登录已完成，`pnpm exec wrangler whoami` 可确认 Cloudflare 账号。

## 服务器端配置

生产 Worker 非敏感变量：

- `WHOOP_REDIRECT_URI=https://biotrip.ccwu.cc/api/whoop/callback`
- `BAILIAN_REGION=cn-beijing`
- `BAILIAN_PLANNING_MODE=auto`：三个 Agent 与 FlyAI 密钥库齐备时优先走百炼托管智能体（比赛要求路径），否则回退到标准模型 API。详见[百炼 Agent 配置](bailian-agent-setup.md)。

WHOOP Client ID 已配置在 Worker vars；以下服务端密钥应写入 Cloudflare Worker secrets。不要写进 `wrangler.jsonc`、Git、命令参数或聊天内容：

- 已配置：`AUTH_SECRET`、`WHOOP_CLIENT_SECRET`、`WHOOP_COOKIE_SECRET`、`BAILIAN_API_KEY`。
- **待核实**：`RESEND_API_KEY`。本文此前记录为"已配置"，而 README 记录为"仍需配置"，两者矛盾且都未实际核对。以 `pnpm exec wrangler secret list` 的输出为准；未配置则线上无法发送验证码、无法注册。
- 邮箱服务设置见[邮箱登录说明](email-auth-setup.md)。
- 百炼非敏感变量：Workspace ID、区域、三个 Agent/环境 ID 与 FlyAI Vault ID 已在 `wrangler.jsonc` 中配置。
- 可选：`BIOTRIP_DIAGNOSTIC_TOKEN`，用于 `/api/internal/provider-check` 诊断端点。**未设置时该端点返回 404。** 该端点为临时诊断用途，可修改百炼 Agent 配置与 Vault 凭据并触发真实计费搜索，提交比赛源码前应删除（见[改进计划](improvement-plan.md) 1.1）。

## 数据库迁移

`migrations/` 共 5 个文件。**必须先应用迁移，再部署代码。**

```bash
pnpm exec wrangler d1 migrations list biotrip-users --remote
pnpm exec wrangler d1 migrations apply biotrip-users --remote
```

| 迁移 | 建的表 | 未应用的后果 | 代码是否有降级 |
| --- | --- | --- | --- |
| `0001_accounts.sql` | `accounts` `login_codes` `sessions` `profiles` `trip_shares` | 无法登录 | 无 |
| `0002_password_auth.sql` | `account_passwords` `auth_rate_limits`；`login_codes.purpose` | 无法密码登录；规划租约写不进去 | 无。**已确认应用** |
| `0003_journeys.sql` | `journeys` `journey_feedback` `journey_memories` | 所有旅程接口返回 503，产品不可用 | **无降级** |
| `0004_whoop_connections.sql` | `whoop_connections` | WHOOP 无法跨设备持久化 | 有，`whoop.ts` 退回 Cookie |
| `0005_learned_preferences.sql` | `learned_preferences` | 偏好学习静默失效 | 有，`preferences.ts` 返回空 |

⚠️ `0003`/`0004`/`0005` 的应用状态**尚未核实**。`0003` 缺失是致命的，因为 `journeys.ts` 没有降级路径。

邮箱验证码通过 Resend 的 HTTPS API 发送，不使用 Cloudflare Workers Email Sending 绑定，也无需购买 Workers Paid。发信域使用 `notify.biotrip.ccwu.cc`；在 Resend 中验证该域并按其控制台添加 DNS 记录后，将 API Key 存为 Cloudflare Worker Secret `RESEND_API_KEY`。发件人由非敏感变量 `RESEND_FROM_EMAIL` 设置，当前配置为 `BioTrip <login@notify.biotrip.ccwu.cc>`。Cloudflare Email Routing 可单独用于根域收信转发；它不是登录验证码发信通道。FlyAI API Key 只配置在百炼旅行 Agent 所用的运行环境，不配置到 BioTrip Worker，也不交给健康解读 Agent。对百炼资源进行创建和真实调用前，先在百炼控制台确认账号权限、地域、配额及可能产生的费用。

BioTrip WHOOP App、百炼 API Key、Resend 与 FlyAI Vault 已配置。2026-10-01 实际调用确认百炼 Key 的模型接口可用；原 Agent `403` 来自 Key 的自定义权限限制，用户确认改为默认业务空间“全部”后 Agent 接口恢复。飞猪凭证只注入旅行 Agent 会话，用户 WHOOP OAuth 授权仍需独立实测。

## WHOOP Developer Dashboard

使用独立的 BioTrip App，不复用目前绑定到 ChatGPT GPT 的 `whooper` App。BioTrip App 已建并登记下列信息：

- Privacy Policy URL：`https://biotrip.ccwu.cc/privacy`
- Redirect URI：`https://biotrip.ccwu.cc/api/whoop/callback`
- Scope：`read:recovery`、`read:cycles`、`read:sleep`、`read:workout`、`read:body_measurement`、`read:profile` 及 `offline`。

Client ID、Client Secret 与 Cookie 加密密钥已配置到 Worker。应用处于 Sandbox（最多 10 位成员）；需要 WHOOP 审批升级 Build 后才能面向更多真实用户。注册 callback 不等于 WHOOP 用户已授权。

## 当前部署状态

1. 线上 Worker Version ID：`a798497d-5874-413c-a3d7-da550a21401a`（2026-10-01 部署）；生产域名与 Custom Domain 正常。
2. ⚠️ **该版本早于 commit `7e16b18`（统一规划流水线）和 `263d726`（文档与代码对齐）。线上运行的不是当前仓库代码。** 重新部署后 `BAILIAN_PLANNING_MODE=auto` 生效，三个 Agent 与 Vault 均已配置，因此首次真实规划会走 Managed Agent，按 0.5 元/小时收取运行时费；部署前先确认百炼 10 小时免费额度的剩余量与到期日。
3. WHOOP OAuth 密钥、百炼三组 Agent/环境、当地信息 Agent 搜索、百炼 Worker Secret、FlyAI Vault 与旅行 Agent Skill/工具均已配置。**"已配置"指平台侧资源配置完成，不代表链路已验证。**
4. 已应用 `0002_password_auth.sql`，默认邮箱密码登录，个人档案提供首次密码设置；首次设置与忘记密码使用邮箱验证码。旧账号、档案和会话保留。`0003`/`0004`/`0005` 的应用状态见上文「数据库迁移」。
5. WHOOP App 登记为 Sandbox，最多 10 个连接成员；用户授权连接仍需独立验证。
6. 生成接口支持持续进度与心跳。**截至本文更新，尚未成功完成过一次真实的端到端规划**，完整可用性以真实 `POST /api/plan` 返回 `source:"live"`、`provenance.stages` 全部 `ok`、`flyai.sourceCount > 0` 为准。

逐条核实步骤见 [project-plan.md 第 3 节](project-plan.md)。
