# BioTrip · 让行程适合今天的你

BioTrip 是手机优先、可添加到主屏幕的响应式旅行规划 PWA。开始新旅程时由 BioTrip 主动逐轮询问，回答会留在对话中供用户回看和修改；收集完毕后再展示本次数据用途并请求授权。它把旅行者选定的节奏、感官与颜色偏好、当下自评、时区变化，以及可选的 WHOOP 身体信号组合起来，搜索真实的飞猪旅行服务和目的地公开信息，再给出可核验、可调整的行程建议。

## 真实数据与明确边界

- 没有真实百炼 Agent、FlyAI API Key 与 WHOOP OAuth 配置时，规划按钮保持不可用；应用不生成示例行程或假造搜索结果。
- WHOOP 连接后，每次规划前都要单独同意。健康解读 Agent 接收近 7 天各相关集合最多 100 条的 WHOOP API 返回记录及身体测量；WHOOP 姓名与邮箱只用于显示连接身份，不交给 AI。
- 健康数据先发往专用健康解读 Agent，结果缩减为节奏和环境条件。当地信息只接收城市、日期和服务/饮食偏好；旅行规划接收抽象节奏条件与本次明确列出的个人旅行记忆，不接收 WHOOP 原始记录。
- 旅行规划只提供建议和真实来源链接，不代替用户预订、付款、下单或修改第三方行程。医疗与放松内容只提供官方公开信息，不提供诊断或疗效承诺。
- OAuth token 使用加密的 HttpOnly Cookie，并按账户隔离；用户可断开并撤销访问。登录、档案与分享记录存入 Cloudflare D1，WHOOP 指标不写入数据库。行程方案可由用户选择保存在当前设备。
- 分享内容创建前需单独确认，公开页不含日期、日程、健康数据或个人记忆；分享链接可在个人档案中撤回。
- 了解完整数据流请见 [隐私与数据说明](/privacy) 和[平台接入清单](docs/platform-access-checklist.md)。

## 架构

```
src/lib/planning/            规划流水线（唯一编排实现）
  contract.ts                类型、DataGrant、buildStageInput、PlannerError
  stages.ts                  唯一阶段表：授权 / 可降级 / 必需 / 预算
  prompts.ts                 全部提示词集中一处
  pipeline.ts                顺序、预算、中断、降级、progress、provenance
  providers/                 bailian-agent（比赛要求）· bailian-model（兜底）
src/lib/preferences.ts       从用户自己的选择学习偏好，可单条删除
src/app/components/planner/  machine.ts（生命周期）· blocks/（内容块）
```

**数据边界由代码强制。** 每个阶段用 `grants` 声明自己能接收什么，`buildStageInput` 是唯一构造阶段输入的地方 —— 未声明的授权永远不会被复制进去。只有 `health_insight` 拿到 WHOOP 原始记录，而它的 Agent 配置为无任何工具。FlyAI 凭据由 provider 绑定到单次会话，从不作为阶段输入、从不进 prompt。`src/lib/planning/grants.test.mjs` 用断言守着这条线。

**记忆与偏好不由 Agent 决定。** Agent 是无状态单次会话；每次由 Worker 按你本次授权的范围读出记忆、注入 prompt。学习与读写在 Worker + D1 完成，只从你自己的选择和自评中学习，`hits ≥ 2` 才升级为下次默认值。

**降级是声明式的。** 联网检索配额耗尽时标记为「本次未核验」，行程继续用已核验来源编排，而不是整单失败；每份行程都带 `provenance`，界面据此区分已核验与未核验。

**无感交互。** WHOOP 连接一次后长期保持（存服务端加密 D1，换设备、清 Cookie 都不掉线），只有你手动断开才解除；草稿在停止输入后自动保存，没有保存按钮；重复选择过的偏好会自动带入下一次旅程；授权失效时自动降级为主观自评规划并提示重连，不会让行程失败。

## Cloudflare 部署

项目按 Cloudflare Workers 配置，生产域名为 `https://biotrip.ccwu.cc`，WHOOP 回调为 `https://biotrip.ccwu.cc/api/whoop/callback`。部署命令、密钥清单和 WHOOP 控制台设置见[Cloudflare 部署说明](docs/cloudflare-deployment.md)。

## 本地运行

```bash
corepack pnpm install
cp .env.example .env.local
corepack pnpm dev
```

OAuth 回调本地地址为 `http://localhost:3000/api/whoop/callback`，必须先在独立的 BioTrip WHOOP Developer App 中注册。线上环境必须为 BioTrip 配置独立 HTTPS 域名、公开隐私说明及精确匹配的 OAuth 回调。

## 服务配置

先完成 [百炼 Agent 配置](docs/bailian-agent-setup.md)，然后在服务端 `.env.local` 中填写：

- WHOOP Client ID / Client Secret / Redirect URI 和 Cookie 加密秘密。
- 百炼 API Key、工作空间、旅行 Agent、无工具健康 Agent 与当地信息 Agent 的 ID 和运行环境。
- FlyAI API Key 只放在百炼旅行 Agent 的受控运行环境中，不放进 BioTrip 前端或 `.env.local`。

`docs/competition-rules-and-data.md` 记录了比赛规则核对、赛程、数据使用范围和费用来源。

## 接入与发布状态

生产环境已配置 WHOOP OAuth、百炼 Managed Agents、健康解读/当地服务/旅行编排三个 Agent，以及只在旅行 Agent 会话中使用的 FlyAI 凭据 Vault。WHOOP App 目前是 Sandbox，最多 10 个连接成员。默认支持邮箱和密码登录；新用户首次验证邮箱并设置密码，已有验证码账户可在“注册 / 首次设置密码”或个人档案的“登录与安全”设置密码，原账户与记忆保留。“忘记密码”通过邮件验证重置，可选验证码登录仍可用。验证邮件使用 Resend 事务邮件 API；生产环境还需要验证 `notify.biotrip.ccwu.cc` 并写入 Worker Secret `RESEND_API_KEY`。Cloudflare Email Routing 可免费用于自定义地址收信转发，不负责给任意用户发送登录码。百炼账户余额显示 ¥0；在可用额度或余额恢复前，真实规划请求可能因供应商余额失败，不会退回演示数据。邮箱配置步骤见[邮箱登录说明](docs/email-auth-setup.md)，部署与平台验证状态见[平台接入清单](docs/platform-access-checklist.md)。

## 仓库与安全

不要提交 WHOOP 原始数据、OAuth Token、Client Secret、百炼/FlyAI 密钥、报名身份证件或其他个人信息。`.env.local` 已排除在 Git 之外。提交比赛材料之前，单独核对作品可访问性、报名身份信息与主办方宣传授权。
