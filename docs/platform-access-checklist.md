# 平台账号与真实接入清单

**最后更新：2026-10-01**

本清单区分三件事：**平台侧资源配置完成**、**代码侧对接完成**、**真实链路已验证**。此前版本把三者混在一起表述，导致"已配置"被读成"已跑通"。

> ⚠️ **截至本文更新，BioTrip 尚未成功完成过一次真实的端到端规划。** 下表中所有"已配置"均仅指第一层。逐项闭合步骤见 [project-plan.md 第 3 节](project-plan.md)。

状态图例：✅ 已核实 · ⚠️ 已配置但未验证 · ❌ 未完成 · ❓ 记录矛盾或状态未知，需核实

---

## WHOOP

| 检查项 | 状态 | 记录 |
| --- | --- | --- |
| Developer Dashboard 中 BioTrip App 已创建 | ✅ | 独立 App，不复用绑定到 ChatGPT GPT 的旧 `whooper` App |
| 应用状态 | ✅ | Sandbox，0 / 10 members；最多 10 个连接成员，扩容需 WHOOP 审批升级 Build |
| 授权 scopes | ✅ | `read:recovery`、`read:cycles`、`read:sleep`、`read:workout`、`read:profile`、`read:body_measurement`、`offline` |
| `read:profile` 的用途 | ✅ | 仅用于在账户页显示连接的是哪个 WHOOP 账号；姓名与邮箱不发送给任何智能体。与 `src/lib/whoop.ts` 的 `WHOOP_SCOPES` 一致 |
| 回调地址 | ✅ | `https://biotrip.ccwu.cc/api/whoop/callback` |
| 隐私政策 URL | ✅ | `https://biotrip.ccwu.cc/privacy`（2026-10-01 已重写，如实描述三 Agent 数据分流与 D1 加密存储） |
| Worker 侧凭据 | ✅ | Client ID（vars）、Client Secret、OAuth 加密密钥（secrets） |
| Token 存储 | ✅ | AES-256-GCM 加密后存 D1 `whoop_connections`，按账户隔离；Cookie 仅作短路缓存。**注意 `0004` 迁移应用状态为 ❓** |
| **用户真实 OAuth 授权** | ❌ | **从未完成过一次。** 授权前应用拿不到任何会员数据 |
| 授权页 scope 与 `/privacy` 一致性核对 | ❌ | 依赖上一项 |

**Sandbox 的 10 个名额意味着评审期间不会有第二个评委连上自己的 WHOOP。** 产品必须在未连接设备时依然完整可用（代码已支持：`includeWhoop` 可选，`self_report` / `preferences_only` 降级路径），WHOOP 部分应由演示视频承载。

---

## 飞猪 FlyAI

| 检查项 | 状态 | 记录 |
| --- | --- | --- |
| API Key 已获取 | ✅ | 用户提供 |
| 存放位置 | ✅ | 专用百炼 Vault `vlt_01M3JPR3Y0VKX51QYZJMJYR9AR`，凭据显示活跃；同时以 `FLYAI_API_KEY` / `FLYAI_SIGN_SECRET` 存于 Worker Secrets 供签名使用 |
| Vault 注入范围 | ✅ | 只向 `flyai.open.fliggy.com` 注入 Bearer Authorization；前端与健康解读 Agent 均拿不到 |
| 旅行编排 Agent 工具 | ✅ | `agent_01M3F56Y16F23ER53G0ADNGHQR` 已启用 Bash 并挂载 `biotrip-flyai-search@1.0` 只读搜索 Skill |
| 只读工具白名单 | ✅ | `src/lib/flyai.ts` 的 `FLYAI_READ_TOOLS` 限定 8 个官方搜索工具；`/api/flyai/mcp` 桥同样只接受这 8 个 |
| 剩余调用额度 | ❓ | 记录为 4,997 次免费额度，**未重新核实** |
| **真实搜索验证** | ❌ | 未在本轮触发。`bailian-agent-setup.md` 记录了 2026-10-01 一次单次真实搜索成功（HTTP 200、`status=0`、`message=success`、10 个商品链接），但那是签名链路验证，不是完整规划链路 |
| 行为边界 | ✅ | 只搜索，不预订、不付款、不修改订单 |

### ⚠️ 桥接端点的凭据设计待改进

`/api/flyai/mcp` 的唯一鉴权是"请求头 Bearer 等于 `FLYAI_API_KEY`"。在 `BAILIAN_PLANNING_MODE=auto`（托管智能体为主路径）下，真实 FlyAI Key 会离开 Worker、进入百炼 Agent 沙箱、再以 HTTP 头形式回到 Worker。

**建议改为：Vault 中存放一个专用 bridge token 而非真实 Key**，Worker 校验 bridge token，真实 Key 只留在 Worker Secret、永不进沙箱。CLI 的签名反正会被 Worker 重签，Vault 里放什么值不影响正确性。这样即使 Agent 被提示注入诱导执行 `printenv`，泄露的也只是一个可轮换的桥接令牌。见[改进计划](improvement-plan.md) 3.3。

现有的缓解措施：`bailian-evidence.ts` 的 `commandCategory` 会把 `printenv`/`env`/`which`/`flyai config|login|auth` 归类为 `environment_probe`/`flyai_auth` 并触发 `FLYAI_UNSUPPORTED_PROBE` 使该阶段失败；搜索次数上限 4 次、bash 上限 6 次、help 上限 1 次。

---

## 阿里云百炼

| 检查项 | 状态 | 记录 |
| --- | --- | --- |
| Workspace | ✅ | `llm-sdk0kiuxwrmb86l8`，地域 `cn-beijing` |
| 健康解读 Agent | ✅ | `agent_01M3ES46BRAMKK5MJPCHZA4K15` / `env_ODE2ZTE4OTJkYmJhNGIxMD`。**无工具、无 Skill、无 MCP、无旅行凭据** |
| 当地信息 Agent | ✅ | `agent_01M3F4SHFW27RS5P7024YN9QM4` / `env_YzFmNDg1MGRkNWFhNDk4ZD`。仅启用 `web_search` |
| 旅行编排 Agent | ✅ | `agent_01M3F56Y16F23ER53G0ADNGHQR` / `env_NGU1Nzc1NjVmN2U4NDMyZm`。Bash + `biotrip-flyai-search@1.0` + FlyAI Vault |
| API Key | ✅ | 已作为 Worker Secret 配置。2026-10-01 实际调用确认模型接口可用 |
| 403 AccessDenied 事件 | ✅ 已解决 | 原因是 BioTrip 专用标准 Key（ID `7479922`）的自定义权限仅允许模型、拒绝 Agent；经用户明确同意改为该业务空间"全部"权限后，Agent 资源接口恢复 200。**该修复不能说明模型免费额度仍可用，也不能让 Token Plan Key 调用托管会话接口** |
| Agent 模型 | ✅ | 控制台配置为 `qwen3.8-flash`；模型 API 兜底路径用 `BAILIAN_PLAN_MODEL=qwen3.7-flash` |
| 传输模式 | ⚠️ | `BAILIAN_PLANNING_MODE=auto`（commit `263d726` 起）。托管智能体优先，模型 API 兜底。**此变更尚未部署到线上** |
| 账户余额 | ❌ | 此前显示 **¥0.00** |
| `qwen3.7-flash` 免费额度 | ⚠️ | 2026-10-01 控制台核实仍有，已开启用完即停。**额度和有效期以控制台当前显示为准** |
| Managed Agent 运行时额度 | ❓ | 官方 10 小时抵扣、30 天有效，不抵扣模型或工具费。**剩余量与到期日未核实** |
| 联网搜索计费 | ⚠️ | 标价 ¥0.03/次 |
| **真实 Session 调用验证** | ❌ | 本轮未发起可能计费的模型、`web_search` 或 Managed Agent Session 请求 |

### 运行时数据边界（代码强制，非提示词约定）

用户授权后：WHOOP 原始记录**仅**进入无工具的健康解读 Agent；当地信息 Agent 只收城市、日期、服务与饮食偏好；旅行编排 Agent 只收行程摘要、抽象节奏条件与用户确认过的旅行记忆，且**仅该 Agent 的 Session 绑定 FlyAI Vault**。

该边界由 `src/lib/planning/contract.ts` 的 `DataGrant` + `buildStageInput` 强制：`stages.ts` 里每个阶段声明自己能接收什么，`buildStageInput` 是唯一构造阶段输入的地方，未声明的授权永远不会被复制进去。`src/lib/planning/grants.test.mjs` 用 10 条断言守着这条线，已纳入 `pnpm test`（43/43）。

---

## Cloudflare 生产部署

| 检查项 | 状态 | 记录 |
| --- | --- | --- |
| 生产域名 | ✅ | `https://biotrip.ccwu.cc`，Custom Domain，HTTPS 正常解析 |
| 架构 | ✅ | Workers + vinext，D1 数据库 `biotrip-users`（`4010c5a8-aba4-4323-83e5-bc3bd76b00f9`）。不是静态 Pages 导出 |
| Worker Secrets | ✅ | `AUTH_SECRET`、`WHOOP_CLIENT_SECRET`、`WHOOP_COOKIE_SECRET`、`BAILIAN_API_KEY` |
| `RESEND_API_KEY` | ❓ | **记录矛盾**：本文与 `cloudflare-deployment.md` 曾记录为已配置，README 曾记录为待配置。以 `pnpm exec wrangler secret list` 为准 |
| 发信域 `notify.biotrip.ccwu.cc` | ❓ | Resend 域名 DNS 验证状态**未核实**。未通过则验证码邮件不可用、线上无法注册 |
| 线上页面可打开 | ✅ | 首页、邮箱登录页、隐私页均可打开；未登录访问规划状态接口返回"请先登录" |
| D1 迁移 | ❓ | 只有 `0002_password_auth.sql` 有应用记录。**`0003`/`0004`/`0005` 状态未知，其中 `0003_journeys.sql` 缺失会让所有旅程接口 503** |
| **线上代码版本** | ❌ | Version `a798497d-5874-413c-a3d7-da550a21401a`，**早于 `7e16b18` 和 `263d726` 两次提交**，线上运行的不是当前仓库代码 |

（历史上还部署过 Version `bd507be2-4162-47a3-98c4-4cfdb1d0d354`，已被 `a798497d` 取代。）

---

## 邮件服务

| 检查项 | 状态 | 记录 |
| --- | --- | --- |
| 发信通道 | ✅ 代码完成 | Resend REST API（`https://api.resend.com/emails`），从 Worker 直接调用；不使用 Cloudflare Workers Email Sending 绑定，无需 Workers Paid |
| 发件人 | ✅ | `BioTrip <login@notify.biotrip.ccwu.cc>`，由非敏感变量 `RESEND_FROM_EMAIL` 设置 |
| Cloudflare Email Routing | ✅ 可用 | 仅用于根域收信转发（如 `support@biotrip.ccwu.cc`），**不是验证码发信通道**，可选 |
| 邮件内容边界 | ✅ | 只发送邮箱地址和一次性验证码；密码、WHOOP 数据与旅行数据都不进邮件 |
| **真实发送验证** | ❌ | 未验证。依赖上面两个 ❓ 项 |

---

## 其他服务与数据真实性

| 项 | 状态 | 记录 |
| --- | --- | --- |
| 蚂蚁阿福 / AQ | ❌ 不接入 | 未找到适用于本项目的公开外部开发者 API 凭据或授权，**不宣称已接入** |
| 保险、医疗、按摩、温泉、餐饮与食疗内容 | ✅ | 使用百炼/FlyAI 检索真实公开服务方资料；不构成保单、诊疗、疗效保证或服务预约 |
| 分享页 | ✅ | 由用户主动生成；不含 WHOOP 数据、日期、详细日程或个人记忆；90 天到期，可在个人档案撤回 |
| Token Plan 套餐 Key | ✅ 明确排除 | 官方限定在兼容的 AI 编程/智能体工具内交互式使用，排除应用后端。`src/lib/planning/providers/bailian-model.ts` 对 `sk-sp-` 前缀硬性拒绝；`/privacy` 已公开承诺不用于应用后端 |
| `decision-model-preview` | ❌ 不接入 | 最大输出长度为 0，无法生成行程；Token Plan 接入仅限个人版且只能通过 AI 工具扩展机制；且 `health_insight` 与 `local_research` 并发、不在关键路径上，替换它对总时长收益约为 0。评估记录见 2026-10-01 |

---

## 尚需完成的实测（按顺序）

1. `wrangler d1 migrations list/apply` —— **先迁移，后部署**。
2. `wrangler secret list` + Resend 控制台，确认 `RESEND_API_KEY` 与 `notify.biotrip.ccwu.cc` 验证状态，实测发一封验证码。
3. 百炼控制台确认余额、`qwen3.7-flash` 免费额度、Managed Agent 10 小时运行时额度剩余与到期日。
4. 在百炼控制台手工跑一遍三个 Agent（不要拿生产 Worker 当第一次调试）。
5. `pnpm run build:vinext && pnpm run deploy:vinext`，记录新 Version ID；注意部署后 `auto` 模式生效会走 Managed Agent 计费。
6. 用 `/api/internal/provider-check` 的 `action=upstream` 验签名链路，再用 `action=probe` 验托管全链路（会烧运行时费，一次即可）。**用完之后按[改进计划](improvement-plan.md) 1.1 删除该端点。**
7. 用户登录后连接自己的 WHOOP，核对授权页范围与 `/privacy` 一致。
8. 跑通一次完整 `POST /api/plan`，确认 `source:"live"`、`provenance.stages` 全部 `ok`、`flyai.sourceCount > 0`，存档 JSON 与截图。
9. 真机检查：单手操作、触控尺寸、动态安全区、桌面布局、添加到主屏幕、离线壳。

### 官方依据

- [Cloudflare Email Routing 设置](https://developers.cloudflare.com/email-service/get-started/route-emails/)
- [Resend 发送邮件 API](https://resend.com/docs/api-reference/emails/send-email) · [验证域名与子域建议](https://resend.com/docs/dashboard/domains/introduction) · [定价](https://resend.com/pricing)
- [WHOOP OAuth 2.0](https://developer.whoop.com/docs/developing/oauth/) · [WHOOP 数据 API](https://developer.whoop.com/api/)
- [飞猪 AI 开放平台](https://flyai.open.fliggy.com/) · [FlyAI 快速开始](https://flyai.open.fliggy.com/docs/quickstart)
- [百炼 Managed Agents 总览](https://help.aliyun.com/zh/model-studio/managed-agents-api-overview) · [会话与事件](https://help.aliyun.com/zh/model-studio/managed-agents-session-event) · [计费](https://help.aliyun.com/zh/model-studio/managed-agents-billing)
- [Token Plan 概述](https://help.aliyun.com/zh/model-studio/token-plan-overview) · [Token Plan 个人版](https://help.aliyun.com/zh/model-studio/token-plan-personal-overview)
- [大赛官网](https://opc.aliyun.com/feizhu) · [大赛参赛指南](https://alidocs.dingtalk.com/i/nodes/QG53mjyd800agdlKHebwk4Zj86zbX04v)

平台价格、配额和审批状态变化很快，**部署或提交当日需重新核对**。
