# 平台账号与真实接入清单

**更新日期：2026-09-28**

本清单分别记录平台资源配置和端到端运行验证。服务端已接上真实 WHOOP OAuth、阿里云百炼 Managed Agents 与飞猪 FlyAI 凭据；本轮未启动会产生百炼费用的规划调用，且还没有由用户完成线上 WHOOP 授权，因此不能声称已读取账户数据或完成一次端到端规划。

## WHOOP

| 检查项 | 已核实状态 |
| --- | --- |
| Developer Dashboard | BioTrip App 已创建 |
| 应用状态 | Sandbox，0 / 10 members；最多 10 个连接成员 |
| 授权 scopes | `read:recovery`、`read:cycles`、`read:sleep`、`read:workout`、`read:profile`、`read:body_measurement`、`offline` |
| 回调 | `https://biotrip.ccwu.cc/api/whoop/callback` |
| 隐私政策 | `https://biotrip.ccwu.cc/privacy` |
| Worker | Client ID、Client Secret、OAuth Cookie 加密密钥已设为服务端配置 |
| 用户授权 | 用户仍需登录 BioTrip 并连接自己的 WHOOP；授权前应用拿不到该用户数据 |

用户必须在 WHOOP 授权页确认数据访问。Sandbox 仅允许 10 位连接成员；扩容需向 WHOOP 申请 Build 审批。

## 飞猪 FlyAI

- 用户提供的 FlyAI API Key 已存入专用百炼 Vault `vlt_01M3JPR3Y0VKX51QYZJMJYR9AR`，凭据显示活跃。
- Vault 只向 `flyai.open.fliggy.com` 注入 Bearer Authorization；前端、Cloudflare Worker 和 WHOOP 健康 Agent 均拿不到 FlyAI Key。
- 旅行编排 Agent `agent_01M3F56Y16F23ER53G0ADNGHQR` 已启用 Bash 并挂载 `biotrip-flyai-search@1.0` 只读搜索 Skill。当地信息 Agent 仅启用 `web_search`；健康解读 Agent 无工具、无 Skill。
- FlyAI 控制台显示还剩 4,997 次免费调用额度。本轮没有触发真实搜索。
- Agent 只能提供可核验的公开搜索结果，不进行预订、付款或修改订单。

## 阿里云百炼

- Workspace：`llm-sdk0kiuxwrmb86l8`，地域 `cn-beijing`。
- 已配置三组 Agent / 环境：健康解读 `agent_01M3ES46BRAMKK5MJPCHZA4K15` / `env_ODE2ZTE4OTJkYmJhNGIxMD`；当地信息 `agent_01M3F4SHFW27RS5P7024YN9QM4` / `env_YzFmNDg1MGRkNWFhNDk4ZD`；旅行编排 `agent_01M3F56Y16F23ER53G0ADNGHQR` / `env_NGU1Nzc1NjVmN2U4NDMyZm`。
- 百炼 API Key 已作为 Cloudflare Worker Secret 配置，模型权限仅选 Qwen3.8-Flash；控制台的 IP 范围为全部 IPv4/IPv6。FlyAI Vault ID 已加入 Worker 配置。
- 运行时数据边界：用户授权后，WHOOP 指标仅发送给无工具健康解读 Agent；当地信息 Agent 收到目的地和服务/饮食偏好；旅行 Agent 收到行程摘要与路线条件，并且仅旅行 Agent Session 绑定 FlyAI Vault。
- 百炼控制台余额显示 ¥0.00。本轮未发起可能计费的模型、web_search 或 Managed Agent Session 请求。余额/可用免费配额不足时，真实规划会失败并明确报错，不会展示演示结果。

## Cloudflare 生产部署

- 生产域名：`https://biotrip.ccwu.cc`；使用 Workers + vinext，D1 数据库 `biotrip-users`，不是静态 Pages 导出。
- D1、账户鉴权和 WHOOP 连接凭据加密存储已部署；Worker Secrets 包括 `AUTH_SECRET`、`WHOOP_CLIENT_SECRET`、`WHOOP_COOKIE_SECRET`、`BAILIAN_API_KEY`。
- 本轮已构建并发布 Worker，Version ID：`bd507be2-4162-47a3-98c4-4cfdb1d0d354`。线上首页、邮箱登录页和隐私页均可打开；未登录访问规划状态接口会返回“请先登录”。
- Cloudflare Email Routing 可免费收信和转发；它不负责向任意用户发送验证码。验证码代码已切换为 Resend REST API，采用发信子域 `notify.biotrip.ccwu.cc`，与根域收信记录分离。
- Resend 域名尚未验证，Worker Secret `RESEND_API_KEY` 尚未配置，因此线上验证码邮件仍不可用。完成 Resend 域名 DNS 验证并写入 Worker Secret 后才可验证真实登录流程。

## 其他服务和数据真实性

- 项目计划接入蚂蚁阿福/AQ，但没有找到适用于本项目的公开外部开发者 API 凭据或授权，当前不宣称已接入。
- 当地保险、医疗、按摩、温泉、餐饮与食疗内容使用百炼/FlyAI 搜索真实公开服务方资料；不构成保单、诊疗、疗效保证或服务预约。
- 分享页由用户主动生成；分享信息不包含 WHOOP 数据、日期、详细行程或个人记忆。

## 尚需完成的实测

1. 在 Resend 验证 `notify.biotrip.ccwu.cc`，按控制台提供的 DNS 记录添加发信授权；创建 API Key 后以 Cloudflare Worker Secret 方式写入 `RESEND_API_KEY`，再验证邮箱登录。
2. 如需收件地址（例如 `support@biotrip.ccwu.cc`），可在 Cloudflare Email Routing 添加已验证的转发目标和路由规则；收件转发为可选项，不影响验证码发信。
3. 用户登录后连接自己的 WHOOP 并检查授权页范围。
4. 在百炼余额/免费额度可用后，由用户在每次规划时确认发送本次 WHOOP 指标，再验证百炼与 FlyAI 的真实搜索链路。

### 官方依据

- [Cloudflare Email Routing 设置](https://developers.cloudflare.com/email-service/get-started/route-emails/)
- [Resend 发送邮件 API](https://resend.com/docs/api-reference/emails/send-email)
- [Resend 验证域名与子域建议](https://resend.com/docs/dashboard/domains/introduction)
- [Resend 定价](https://resend.com/pricing)
- [WHOOP OAuth 2.0](https://developer.whoop.com/docs/developing/oauth/)
- [WHOOP 数据 API](https://developer.whoop.com/api/)
- [飞猪 AI 开放平台](https://flyai.open.fliggy.com/)
- [FlyAI 快速开始](https://flyai.open.fliggy.com/docs/quickstart)
- [百炼 Managed Agents 总览](https://help.aliyun.com/zh/model-studio/managed-agents-api-overview)
- [大赛官网](https://opc.aliyun.com/feizhu)
- [大赛参赛指南](https://alidocs.dingtalk.com/i/nodes/QG53mjyd800agdlKHebwk4Zj86zbX04v)
