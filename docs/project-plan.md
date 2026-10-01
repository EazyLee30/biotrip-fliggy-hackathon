# BioTrip 项目状态与交付清单

**更新：2026-10-01 23:50**
**本文是项目状态的唯一权威来源。** 平台账号细节见[平台接入清单](platform-access-checklist.md)，部署操作见[Cloudflare 部署说明](cloudflare-deployment.md)，改进排期见[改进计划](improvement-plan.md)。

---

## 0. 一句话现状

**代码质量已经过关，但产品从未真实跑通过一次，且线上运行的版本与仓库里的代码不是同一份。**

| 维度 | 状态 |
| --- | --- |
| 代码 | ✅ `tsc --noEmit` 0 errors；`pnpm test` **43/43 pass**；`pnpm lint` 7 problems（2 errors / 5 warnings，全在前端组件） |
| 版本控制 | ✅ 3 个 commit，工作树干净（`a925d3e` → `7e16b18` → `263d726`），`pnpm-lock.yaml` 已入库 |
| 文档一致性 | ✅ `/privacy`、README、`bailian-agent-setup.md`、`solution-selection.md`、`competition-rules-and-data.md` 已与代码对齐（commit `263d726`） |
| **线上部署** | ❌ **生产 Worker 版本 `a798497d` 早于 `7e16b18` 和 `263d726` 两次提交**，即线上跑的是重构前的代码 |
| **数据库迁移** | ❌ 只有 `0002_password_auth.sql` 有应用记录；`0003`/`0004`/`0005` **状态未知** |
| **端到端验证** | ❌ **从未成功完成过一次真实规划** |
| 市场论证 | ✅ 已补 [市场定位与差异化](market-and-differentiation.md) |

---

## 1. 产品闭环

1. 旅客输入出发/目的地、两地实际当地时间与 IANA 时区、返程日期、既有固定日程和计划密度偏好（`flexible`/`structured`）。
2. 旅客选择体验意图、颜色氛围、感官环境（安静少噪／自然气息／柔和光线／人少宽松）和所需服务类别；疲劳与压力自评、体验后身体与情绪反馈均为可选。
3. 如已连接 WHOOP，页面显示该账号真实返回的恢复、HRV、静息心率、睡眠与活动周期摘要；缺失字段保持为空，不以模拟指标填补。
4. 每次生成前明确展示本次发往各阶段的内容；只有用户勾选同意后才开始真实检索与编排。
5. 健康解读阶段（无任何工具的 Agent）把近 7 天 WHOOP 记录转成抽象节奏条件；当地资料阶段独立检索真实公开来源；行程编排阶段经 FlyAI 检索真实商品并生成可审阅的行程。
6. 旅客按站点反馈体感与情绪后可重新规划下一段；重复出现的选择沉淀为下次默认值（`hits ≥ 2`），可在个人档案逐条删除。
7. 每份行程带 `provenance`，前端逐阶段显示"已核验／本次未核验"、飞猪搜索次数与来源数、身体数据依据。

---

## 2. 已完成的代码

### 架构
- **单一编排实现** `src/lib/planning/`：`contract.ts`（类型、`DataGrant`、`buildStageInput`、`PlannerError`）· `stages.ts`（唯一阶段表：授权／可降级／必需／预算）· `prompts.ts`（全部提示词集中一处）· `pipeline.ts`（顺序、预算、中断、降级、progress、provenance）· `providers/`（`bailian-agent` 为比赛要求的主路径，`bailian-model` 为兜底，同一 `PlanningProvider` 接口）。
- `src/app/api/plan/route.ts` 已退化为适配器：鉴权 → 校验 → 跑流水线 → 落库。
- 删除了 `managed-plan.ts` 与重复的 `validateInput`/`parseSchedule`/时区运算副本。

### 隐私边界（可执行，不靠提示词）
- 每个阶段用 `grants` 声明能接收什么；`buildStageInput` 是唯一构造阶段输入的地方，未声明的授权永远不会被复制进去。
- 只有 `health_insight` 拿到 WHOOP 原始记录，且其 Agent 配置为无任何工具／Skill／MCP；服务端在创建会话后校验 `agent.tools` 为空才投递数据。
- FlyAI 凭据由 provider 绑定到单次会话，从不作为阶段输入、从不进 prompt。
- `src/lib/planning/grants.test.mjs` 用 10 条断言守着这条线，已纳入 `pnpm test`。
- `whoop.ts` 的 `omitIdentifierFields` 剥除 `id`/`user_id`/`cycle_id`/`sleep_id`/`v1_id`；日志只输出结构形状（`shape()`），不输出值。

### 真实性与降级
- 模型只返回 `source_index`，地点名称与 URL 由服务端从真实 FlyAI 结果回填；索引越界报 `UNVERIFIED_SOURCE_URL`。
- 当地服务来源必须命中本轮 `web_search_call.action.sources`，否则丢弃该条。
- `local_research` 失败 → 标记 `local_information_unverified`，禁止推荐具体店名，并在 `adjustments` 中明示；FlyAI 库存是 load-bearing，失败即整单失败。
- 固定日程的 date/time/name 必须完整保留（`parsePlan` 逐条比对）；日期区间、抵达顺序、每日覆盖、最多 31 天均硬校验。
- 时区：`localDateTimeAsInstant` 迭代求偏移并回读比对，能识别夏令时空洞并要求用户改时间。

### 账户与数据
- 邮箱密码登录（PBKDF2-HMAC-SHA256，10 万轮，`AUTH_SECRET` 做 pepper）+ 6 位验证码登录／设置密码／重置密码；验证码与会话只存哈希；重置密码使其他设备会话失效。
- WHOOP OAuth：state 校验、refresh token 流程、AES-256-GCM 加密后存 D1（`whoop_connections`），一次授权跨设备有效；授权失效降级为自评规划而不是让行程失败。
- 旅程乐观锁（`version`）、账号级规划租约 + 每小时 12 次上限（`planning/rate-limit.ts`，SQL 有真实数据库测试覆盖）。
- 反馈与记忆写入用 D1 batch + `changes()=1` 条件插入，避免并发下的孤儿数据。

### 前端
- 手机优先响应式 PWA、manifest、离线应用壳、`/privacy` 说明页。
- `planner/machine.ts` 把生命周期规则变成声明式能力表，前端不再各自推导"现在能不能开始旅程"；`planner-machine.test.mjs` 断言其与服务端规则一致。
- `planner/blocks/provenance.tsx` 逐阶段渲染核验状态；`planner/blocks/learned-preferences.tsx` 让自动记忆可查看、逐条删除、全清。
- 草稿停止输入 1.4 秒后自动保存。
- SSE 持续进度 + 10 秒心跳；前端可中止，中止后回查服务端保存状态。

---

## 3. 🔴 Tier 0：阻塞项（必须在其他一切之前完成）

### 3.1 生产 D1 迁移状态未知 ← 最危险

`migrations/` 有 5 个文件，但文档只记录了 `0002_password_auth.sql` 已应用。

| 迁移 | 建的表 | 未应用的后果 | 代码是否有降级 |
| --- | --- | --- | --- |
| `0001_accounts.sql` | `accounts` `login_codes` `sessions` `profiles` `trip_shares` | 无法登录 | ❌ 无 |
| `0002_password_auth.sql` | `account_passwords` `auth_rate_limits`；`login_codes.purpose` | 无法用密码登录；规划租约写不进去 | ❌ 无 |
| **`0003_journeys.sql`** | `journeys` `journey_feedback` `journey_memories` | **所有旅程接口 503「旅程服务暂时不可用」，产品完全不能用** | ❌ **无** |
| **`0004_whoop_connections.sql`** | `whoop_connections` | WHOOP 无法跨设备持久化 | ✅ `whoop.ts:184` 有 try/catch，退回 Cookie |
| **`0005_learned_preferences.sql`** | `learned_preferences` | 偏好学习静默失效 | ✅ `preferences.ts` 有 try/catch，返回空 |

**待办**：
1. `pnpm exec wrangler d1 migrations list biotrip-users --remote` 查看已应用记录。
2. 缺哪个补哪个：`pnpm exec wrangler d1 migrations apply biotrip-users --remote`。
3. **必须先应用迁移，再部署新代码。**

### 3.2 线上代码落后仓库两次提交

生产 Worker Version `a798497d-5874-413c-a3d7-da550a21401a` 部署于 `7e16b18`（22:51）和 `263d726`（23:36）之前。**线上跑的是重构前的代码**，其中包括：
- 已被删除的 `managed-plan.ts` 双份编排实现
- `263d726` 修掉的那批问题（隐私页错误声明、`plan/status` 信息泄露、规划租约泄漏等）

⚠️ **重新部署会同时切换 `BAILIAN_PLANNING_MODE`**：`wrangler.jsonc` 现在是 `auto`，三个 Agent + Vault 都已配置 → 部署后首次真实规划会走 **Managed Agent，运行时费 0.5 元/小时**。部署前先在百炼控制台确认 10 小时免费额度的剩余量和有效期。

**待办**：先做 3.1，再 `pnpm run build:vinext && pnpm run deploy:vinext`，记录新的 Version ID 到 `cloudflare-deployment.md`。

### 3.3 邮件登录状态自相矛盾

`README.md` 说"生产环境还需要验证 `notify.biotrip.ccwu.cc` 并写入 Worker Secret `RESEND_API_KEY`"；`cloudflare-deployment.md:35` 说 `RESEND_API_KEY` 已配置。**两者必有一错，未核实。**

不通过的后果：**线上无法注册，评委进不来。**

**待办**：`pnpm exec wrangler secret list` 确认；Resend 控制台确认 `notify.biotrip.ccwu.cc` 的 DNS 验证状态；实测发一封验证码并检查收件箱与 Resend 投递日志。

### 3.4 端到端真实规划从未成功

| 依赖 | 状态 | 来源 |
| --- | --- | --- |
| 百炼余额 | **¥0.00** | `platform-access-checklist.md` |
| `qwen3.7-flash` 免费额度 | 2026-10-01 控制台核实仍有，已开用完即停 | `bailian-agent-setup.md` |
| Managed Agent 运行时额度 | 10 小时，30 天有效，剩余量**未核实** | `competition-rules-and-data.md` |
| FlyAI 剩余调用 | 记录为 4,997 次，**未核实** | `platform-access-checklist.md` |
| WHOOP 真实授权 | **用户从未完成过一次** | `platform-access-checklist.md` |

**待办顺序**：
1. 在**百炼控制台**手工跑一遍三个 Agent（不要拿生产 Worker 当第一次调试）。
2. `/api/internal/provider-check` 的 `action=upstream` 验证 FlyAI 签名链路（单次固定查询）。
3. `action=probe` 验证 managed 全链路：Agent → CLI → `/api/flyai/mcp` 桥 → 飞猪。**会烧 Managed Agent 运行时费，一次即可。**
4. 用户本人完成一次 WHOOP OAuth 授权，核对授权页显示的 scope 与 `/privacy` 一致。
5. 跑通一次完整 `POST /api/plan`，确认返回 `source:"live"`、`provenance.stages` 全 `ok`、`flyai.sourceCount > 0`，**存档 JSON 与截图**。

### 3.5 评委不可能连自己的 WHOOP

WHOOP App 处于 **Sandbox，最多 10 位连接成员**，升级 Build 需要 WHOOP 审批。评审期间不会有第二个评委连上自己的设备。

**待办**：
- 确认未连接 WHOOP 时的体验完整（代码支持：`includeWhoop` 可选，`self_report` / `preferences_only` 降级路径），且界面不显得残缺。
- WHOOP 部分放进**演示视频**，不要让评委现场试。
- 准备一个已连接 WHOOP 的演示账户（用掉 10 个 Sandbox 名额中的 1 个）。

---

## 4. 用户体验与伦理边界

这些不是功能说明，是**已经写进代码和提示词的硬约束**，提交材料应当如此陈述：

- 不从 WHOOP `strain` 推断心理压力。`strain` 是生理活动负荷；压力只来自用户自评，两者分开显示。
- 不从颜色推断固定人格或情绪。颜色只是旅行者自己的氛围表达。
- `flexible`/`structured` 只代表用户选择的计划组织方式，不是心理类型测评。
- 温泉、按摩、地方饮食和医疗服务依据当地公开来源检索；不作医疗诊断、疗效承诺、药物／补剂剂量或营养处方。
- 跨时区节奏依据用户填入的当地时间和 IANA 时区计算；夏令时无效时间要求用户修正。
- 不自动预订、支付或修改现有旅行安排；固定时间项目原样保留并校验。
- 缺失值保持缺失，不填 0；`PENDING_SCORE`/`UNSCORABLE` 如实展示。
- 未核验的检索不得呈现为已核验推荐。

---

## 5. 验收条件

| # | 条件 | 状态 |
| --- | --- | --- |
| 1 | 三个百炼 Agent 使用不同运行环境和最小数据权限；健康 Agent 无工具，FlyAI 仅在旅行 Agent 环境 | ✅ 已配置，`grants.test.mjs` 有断言 |
| 2 | WHOOP OAuth 回调与部署域名精确匹配；拒绝授权、token 续期失败、无效/空评分都有明确状态 | ✅ 代码完成；⚠️ 真实授权未实测 |
| 3 | 任何未配置/报错情况都不产生伪造数据；有效结果有可核验来源和本次检索时间 | ✅ 代码完成；⚠️ 未用真实数据验证过 |
| 4 | 手机单手操作、触控、动态安全区、桌面布局和添加到主屏幕体验通过实际设备检查 | ❌ **未做** |
| 5 | 用户逐次确认健康数据去向；断开 WHOOP 可撤销访问；敏感数据不进普通日志、Git 或前端代码 | ✅ 代码完成 |
| 6 | 发布前评审隐私说明、第三方费用、WHOOP Sandbox 限制、百炼账单与比赛提交授权 | ⚠️ 隐私说明已重写；费用与授权未评审 |
| 7 | **评委能通过公开链接完成注册 → 规划 → 查看真实来源的完整流程** | ❌ **未验证，Tier 0** |

---

## 6. 提交材料清单

| 项 | 状态 |
| --- | --- |
| 大赛 GitHub Issue（官方模板） | ❌ 未提交 |
| 源码仓库链接 + **评委可访问性** | ⚠️ 仓库仍为私有，需决定：转公开／脱敏镜像／加 collaborator |
| 项目名称、场景与亮点说明 | ⚠️ 素材见 [market-and-differentiation.md](market-and-differentiation.md)，尚未成稿 |
| 演示视频 2–3 分钟（强烈建议） | ❌ 未做 |
| 手机截图 | ⚠️ `stitch_biotrip_terminal/` 是设计稿不是真实截图 |
| 在线可访问 Demo | ⚠️ 域名已上线，但见 Tier 0 |
| 报名与宣传授权条款逐条核对 | ❌ 未做（含实名、身份证号、姓名/肖像/声音宣传授权） |

### 提交前必须处理的仓库卫生
- **删除 `/api/internal/provider-check`**（或至少删掉 `tune` 改 Agent system prompt、`bridge` 改 Vault credential 两个 action）。注释自称 "Temporary"。
- `public/design/`（856KB Stitch 设计稿）中只有 `profile_zen_modern-2.jpg` 和 4 个 `jakarta-*.ttf` 被生产引用，其余 11 张应移出 `public/`。
- `public/{file,globe,next,vercel,window}.svg` 是 create-next-app 残留。
- Plus Jakarta Sans 为 SIL OFL 1.1，**仓库缺字体 LICENSE 文件**。
- 若转公开：`wrangler.jsonc` 含 WHOOP Client ID、百炼 Workspace ID、三个 Agent/环境 ID、FlyAI Vault ID、D1 database_id。均非 secret，但需明确决定是否公开。

---

## 7. 参赛硬性要求对照

| 官方要求 | BioTrip 落实 | 状态 |
| --- | --- | --- |
| 在阿里云百炼创建 Managed Agent 并在平台内调试 | 三个 Managed Agent + 独立运行环境，服务端经 Session/Event API 驱动；`auto` 模式下为主路径 | ✅ 已创建；⚠️ 真实调用未验证 |
| 在 Agent 会话中安装官方 Skill `alibaba-flyai/flyai-skill` | 旅行编排 Agent 挂载 `biotrip-flyai-search@1.0`（改编自官方 Skill，见 `bailian/flyai-search-skill/`） | ✅ 已挂载；⚠️ 未实测 |
| 申请 FlyAI API Key 并在百炼运行环境配置验证 | Key 存于专用 Vault `vlt_01M3JPR3Y0VKX51QYZJMJYR9AR`，仅注入旅行 Agent 会话 | ✅ 已配置；⚠️ 未实测 |
| 代码上传 GitHub 并通过 Issue 模板提交 | 见第 6 节 | ❌ 未做 |
| 介绍材料 + 演示视频/截图 | 见第 6 节 | ❌ 未做 |

**评分权重**：创新性 40%（鼓励多模态／主动／空间计算）· 完整度 30%（核心流程跑通、可体验、稳定可验证）· 市场前景 30%。
**分数门槛**：一等奖 ≥95、二等奖 ≥90、三等奖 ≥85、入围 ≥80（不保证必然产生对应奖项）。
**赛程**：提交 09-22 ~ **10-25**；初审 10-26 ~ 11-02；终审 11-03 ~ 11-06；颁奖 11-07 ~ 11-15。

---

## 8. 文档索引

| 文档 | 内容 | 最后更新 |
| --- | --- | --- |
| **本文** | 项目状态与交付清单（唯一权威来源） | 2026-10-01 |
| [improvement-plan.md](improvement-plan.md) | 分层改进计划与 24 天排期 | 2026-10-01 |
| [market-and-differentiation.md](market-and-differentiation.md) | 市场定位、目标人群、差异化、商业路径、反方论证 | 2026-10-01 |
| [solution-selection.md](solution-selection.md) | 方案选型与技术结构决策 | 2026-10-01 |
| [competition-rules-and-data.md](competition-rules-and-data.md) | 比赛规则核对、WHOOP 授权范围、百炼费用 | 2026-10-01 |
| [bailian-agent-setup.md](bailian-agent-setup.md) | 百炼两种传输方式、必需配置、数据校验 | 2026-10-01 |
| [cloudflare-deployment.md](cloudflare-deployment.md) | 部署操作、Worker 变量与 secrets、WHOOP Dashboard | 2026-10-01 |
| [email-auth-setup.md](email-auth-setup.md) | Resend 发信域、密码运维、`AUTH_SECRET` 轮换 | 2026-10-01 |
| [platform-access-checklist.md](platform-access-checklist.md) | 各平台账号配置与实测状态 | 2026-10-01 |
