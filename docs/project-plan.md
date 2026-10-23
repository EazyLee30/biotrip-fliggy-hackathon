# BioTrip 项目状态与交付清单

**本轮更新：四角色架构与流程已按当前代码对齐；最终部署与两次真实端到端验证结果待记录。**
**本文是项目状态的唯一权威来源。** 平台账号细节见[平台接入清单](platform-access-checklist.md)，部署操作见[Cloudflare 部署说明](cloudflare-deployment.md)，改进排期见[改进计划](improvement-plan.md)。

---

## 0. 一句话现状

**当前代码采用三路并行准备、专用无工具编排的四角色流水线。最终发布版本和本轮两次真实生成的验收记录尚未在本文填写。**

| 维度 | 状态 |
| --- | --- |
| 代码 | 本轮最终类型检查、测试与构建结果待发布验收记录；不沿用旧测试数量 |
| 版本控制 | 本轮改动、提交及发布对应关系待最终确认 |
| 文档一致性 | README、本文与 `bailian-agent-setup.md` 已按当前四角色职责对齐；其他文档以对应更新记录为准 |
| **线上部署** | 本轮最终 Worker Version 待记录 |
| **数据库迁移** | 发布前核对生产已应用迁移与当前 `migrations/` 一致 |
| **端到端验证** | 本轮两次真实生成的结果、耗时及来源执行路径待记录 |
| 市场论证 | ✅ 已补 [市场定位与差异化](market-and-differentiation.md) |

---

## 2026-10-04 明亮旅行手记改版

已实现的视觉、行程优先布局、三步创建、活动删除与撤销、分享封面及海报见[本轮执行记录](zen-product-execution.md)。后台持久任务、断线恢复、候选调整确认与版本恢复仍列为后续工作，不能把本轮 UI 发布等同于整份优化计划完成。

## 1. 产品闭环

1. 旅客选择出发地、目的地与日期范围，IANA 时区由地点目录填入；可补充实际当地交通时刻、固定日程和计划密度偏好（`flexible`/`structured`）。未提供交通时刻时使用明确说明的缓冲假设，不把默认时间当作真实航班时间。
2. 旅客选择体验意图、颜色氛围、感官环境（安静少噪／自然气息／柔和光线／人少宽松）和所需服务类别；疲劳与压力自评、体验后身体与情绪反馈均为可选。
3. 如已连接 WHOOP，页面显示该账号真实返回的恢复、HRV、静息心率、睡眠与活动周期摘要；缺失字段保持为空，不以模拟指标填补。
4. 每次生成前明确展示本次发往各阶段的内容；只有用户勾选同意后才开始真实检索与编排。
5. 健康解读、当地公开资料检索、FlyAI 库存检索三路并行准备；WHOOP 读取只影响健康这一路。全部准备工作结束后，专用无工具编排 Agent 接收抽象节奏及已核验来源，生成可审阅的行程。未勾选当地服务时跳过当地检索，库存 Agent 不承担编排。
6. 旅客按站点反馈体感与情绪后可重新规划下一段；重复出现的选择沉淀为下次默认值（`hits ≥ 2`），可在个人档案逐条删除。
7. 每份行程带 `provenance`，前端逐阶段显示"已核验／本次未核验"、飞猪搜索次数与来源数、身体数据依据。

---

## 2. 已完成的代码

### 架构

- **单一编排实现** `src/lib/planning/`：`contract.ts`（类型、`DataGrant`、`buildStageInput`、`PlannerError`）· `stages.ts`（唯一阶段表：授权／可降级／必需／预算）· `prompts.ts` / `inventory.ts`（角色提示词与只读查询）· `pipeline.ts`（三路并行、预算、中断、降级、progress、provenance）· `providers/`（`bailian-agent` 与 `bailian-model` 共享 `PlanningProvider` 接口）。生产 `auto` 优先托管 Agent，托管配置不完整才选择标准模型 API；运行中不重新启动整条链来切换通道。
- `src/app/api/plan/route.ts` 已退化为适配器：鉴权 → 校验 → 跑流水线 → 落库。
- 删除了 `managed-plan.ts` 与重复的 `validateInput`/`parseSchedule`/时区运算副本。

| 角色 | 输入与工具边界 |
| --- | --- |
| 健康解读 `health_insight` | 本次允许的身体、自评与偏好输入；唯一能接收 WHOOP 原始记录的角色，无工具、Skill、MCP 或旅行 Vault |
| 当地检索 `local_research` | 城市、日期、当地服务与饮食偏好；联网搜索真实公开资料，不接收健康指标或 FlyAI 凭据 |
| FlyAI 库存 `flyai_inventory` | 城市、日期、库存类别等旅行查询参数；官方只读 Skill/CLI 与受控 Vault，不接收健康数据，不编排行程 |
| 独立编排 `compose_plan` | 行程、允许的偏好/自评、抽象健康节奏和已核验来源；专用 Agent 无 tools、skills、mcp_servers 或 Vault，不重复搜索 |

四个角色使用独立会话；编排运行环境可复用健康解读的无工具环境，并不要求四个不同环境。`BAILIAN_COMPOSE_AGENT_ID` 必须与库存 Agent 区分，不能只给库存 Agent 提示“不要调用工具”来充当编排角色。

### 隐私边界（可执行，不靠提示词）

- 每个阶段用 `grants` 声明能接收什么；`buildStageInput` 是唯一构造阶段输入的地方，未声明的授权永远不会被复制进去。
- 只有 `health_insight` 拿到 WHOOP 原始记录；健康和编排会话在创建后核对工具配置再投递数据。编排实际快照要求 tools、skills、mcp_servers 均为空，工具调用事件会触发 `COMPOSE_TOOL_CALL_FORBIDDEN`。
- FlyAI 凭据只保存在后台与库存会话的受控 Vault，从不作为阶段输入或提示词内容；其他三个 Agent 不挂载旅行 Vault。
- `src/lib/planning/grants.test.mjs` 用断言守着各阶段输入边界，已纳入项目测试。
- `whoop.ts` 的 `omitIdentifierFields` 剥除 `id`/`user_id`/`cycle_id`/`sleep_id`/`v1_id`；日志只输出结构形状（`shape()`），不输出值。

### 真实性与降级

- 模型只返回 `source_index`，地点名称与 URL 由服务端从真实 FlyAI 结果回填；索引越界报 `UNVERIFIED_SOURCE_URL`。
- 当地服务来源必须命中本轮 `web_search_call.action.sources`，否则丢弃该条。
- 健康解读或当地检索失败会如实标记未核验，按允许输入继续。库存 Skill 的失败可触发一次有预算限制的后台签名通道兜底，`provenance.flyai` 记录 `executor` 与原因；整体库存没有可核验来源或编排失败才终止生成。
- 固定日程的 date/time/name 必须完整保留（`parsePlan` 逐条比对）；日期区间、抵达顺序、每日覆盖、最多 30 个日历日均硬校验。
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

## 3. 发布前核验项

### 3.1 生产 D1 迁移

发布前用生产迁移记录核对当前 `migrations/`。历史文档的应用记录不能代替本轮核验。

| 迁移 | 建的表 | 未应用的后果 | 代码是否有降级 |
| --- | --- | --- | --- |
| `0001_accounts.sql` | `accounts` `login_codes` `sessions` `profiles` `trip_shares` | 无法登录 | ❌ 无 |
| `0002_password_auth.sql` | `account_passwords` `auth_rate_limits`；`login_codes.purpose` | 无法用密码登录；规划租约写不进去 | ❌ 无 |
| **`0003_journeys.sql`** | `journeys` `journey_feedback` `journey_memories` | **所有旅程接口 503「旅程服务暂时不可用」，产品完全不能用** | ❌ **无** |
| **`0004_whoop_connections.sql`** | `whoop_connections` | WHOOP 无法跨设备持久化 | ✅ `whoop.ts:184` 有 try/catch，退回 Cookie |
| **`0005_learned_preferences.sql`** | `learned_preferences` | 偏好学习静默失效 | ✅ `preferences.ts` 有 try/catch，返回空 |
| `0006_preference_kinds.sql` | 扩展 `learned_preferences.kind` 约束 | 新增偏好类别无法保存 | 不应依赖旧约束继续发布 |

**待办**：

1. `pnpm exec wrangler d1 migrations list biotrip-users --remote` 查看已应用记录。
2. 缺哪个补哪个：`pnpm exec wrangler d1 migrations apply biotrip-users --remote`。
3. **必须先应用迁移，再部署新代码。**

### 3.2 发布四角色配置与代码

最终生产版本必须包含当前统一流水线与专用无工具编排 Agent 配置，发布后记录 Worker Version ID；不再用旧提交数量或旧 Version 判断当前部署。

`wrangler.jsonc` 使用 `BAILIAN_PLANNING_MODE=auto`：库存、当地检索、专用编排与 Vault 配置齐备时选托管路径，健康解读缺失则按阶段策略降级。模型与托管运行时额度、计费状态均以当前控制台为准，不把 Token Plan 套餐视作生产后台调用凭据或抵扣依据。

**待办**：先做 3.1，再 `pnpm run build:vinext && pnpm run deploy:vinext`，记录新的 Version ID 到 `cloudflare-deployment.md`。

### 3.3 邮件与账户流程

本轮发布需要核对 Resend 发信域与 Worker Secret，实测首次邮箱验证、设置密码和后续密码登录。已设置密码的用户不必每次使用邮件验证码。

不通过的后果：**线上无法注册，评委进不来。**

**待办**：`pnpm exec wrangler secret list` 确认；Resend 控制台确认 `notify.biotrip.eazylee.si` 的 DNS 验证状态；实测发一封验证码并检查收件箱与 Resend 投递日志。

### 3.4 本轮两次真实端到端规划

| 依赖 | 状态 | 来源 |
| --- | --- | --- |
| 百炼模型与运行时 | 使用当前标准业务空间凭据；余额、额度及用完即停状态按控制台核对 | `bailian-agent-setup.md` |
| 四角色 Agent | 核对库存、当地检索、健康解读和独立编排 ID；健康与编排工具边界不能共用库存配置 | 当前代码与实际会话快照 |
| FlyAI | 检查真实只读搜索与来源执行路径，不沿用旧剩余次数 | `provenance.flyai` 与后台诊断 |
| WHOOP | 本次是否允许、是否读取、缺失或失效是否回退均按实际账号核对 | `provenance.health` 与授权记录 |

**待办顺序**：

1. 核对四个 Agent 的职责、模型、工具与 Vault 配置，确认编排 Agent 三类工具列表为空。
2. 发布当前代码后完成两次真实 `POST /api/plan`，核对 `source:"live"`、真实来源数量、逐阶段核验状态、库存 `executor` 与兜底原因。可跳过或降级的阶段必须如实显示，不能要求未请求的阶段伪装成 `ok`。
3. 检查生成结果保存、刷新恢复、完整日期覆盖、固定日程保留和取消/版本冲突处理；存档脱敏结果与真实界面截图。
4. 若本次使用 WHOOP，核对本人授权及实际身体数据依据；未连接或远期行程同样要完成规划闭环。
5. 最后补充两次结果与耗时、最终 Worker Version。本文暂不填写这些发布验收结果。

### 3.5 WHOOP Sandbox 与未连接体验

WHOOP App 处于 Sandbox，连接名额与升级条件以平台为准。产品不能把评委成功连接 WHOOP 当作完成规划的前提。

**待办**：
- 确认未连接 WHOOP 时的体验完整（代码支持：`includeWhoop` 可选，`self_report` / `preferences_only` 降级路径），且界面不显得残缺。
- WHOOP 部分放进**演示视频**，不要让评委现场试。
- 在可用 Sandbox 名额内准备一个由本人授权的 WHOOP 演示账户。

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
| 1 | 四角色使用最小数据权限；健康与独立编排无工具，FlyAI/Vault 仅在库存会话，编排不得重复搜索 | 代码已强制输入边界与编排工具事件检查；最终生产实测待记录 |
| 2 | WHOOP OAuth 回调与部署域名精确匹配；拒绝授权、token 续期失败、无效/空评分都有明确状态 | 代码支持；本轮实际账号验证记录待补 |
| 3 | 任何未配置/报错情况都不产生伪造数据；有效结果有可核验来源和本次检索时间 | 代码支持；本轮两次真实生成记录待补 |
| 4 | 手机单手操作、触控、动态安全区、桌面布局和添加到主屏幕体验通过实际设备检查 | 最终布局与设备验证记录待补 |
| 5 | 用户逐次确认健康数据去向；断开 WHOOP 可撤销访问；敏感数据不进普通日志、Git 或前端代码 | ✅ 代码完成 |
| 6 | 发布前评审隐私说明、第三方费用、WHOOP Sandbox 限制、百炼账单与比赛提交授权 | ⚠️ 隐私说明已重写；费用与授权未评审 |
| 7 | **评委能通过公开链接完成注册 → 规划 → 查看真实来源的完整流程** | 本轮发布验收记录待补 |

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
- 若转公开：`wrangler.jsonc` 含 WHOOP Client ID、百炼 Workspace ID、四角色 Agent/环境 ID、FlyAI Vault ID、D1 database_id。均非 secret，但需明确决定是否公开。

---

## 7. 参赛硬性要求对照

| 官方要求 | BioTrip 落实 | 状态 |
| --- | --- | --- |
| 在阿里云百炼创建 Managed Agent 并在平台内调试 | 四角色 Managed Agents，服务端经 Session/Event API 驱动；三路并行准备后进入独立无工具编排，`auto` 模式优先此路径 | 当前配置已包含四角色；最终部署实测待记录 |
| 在 Agent 会话中安装官方 Skill `alibaba-flyai/flyai-skill` | 库存 Agent 挂载 `biotrip-flyai-search@1.0`（改编自官方 Skill，见 `bailian/flyai-search-skill/`）；编排 Agent 不挂 Skill | 当前配置与代码支持；每次结果由 `provenance.flyai.executor` 证明实际执行者 |
| 申请 FlyAI API Key 并在百炼运行环境配置验证 | 凭据保存于专用 Vault 与后台签名通道，Vault 只注入库存会话，不进入提示词或前端 | 最终真实来源与执行路径待本轮发布实测记录 |
| 代码上传 GitHub 并通过 Issue 模板提交 | 见第 6 节 | ❌ 未做 |
| 介绍材料 + 演示视频/截图 | 见第 6 节 | ❌ 未做 |

**评分权重**：创新性 40%（鼓励多模态／主动／空间计算）· 完整度 30%（核心流程跑通、可体验、稳定可验证）· 市场前景 30%。
**分数门槛**：一等奖 ≥95、二等奖 ≥90、三等奖 ≥85、入围 ≥80（不保证必然产生对应奖项）。
**赛程**：提交 09-22 ~ **10-25**；初审 10-26 ~ 11-02；终审 11-03 ~ 11-06；颁奖 11-07 ~ 11-15。

---

## 8. 文档索引

| 文档 | 内容 | 最后更新 |
| --- | --- | --- |
| **本文** | 项目状态与交付清单（唯一权威来源） | 四角色流程已更新，发布结果待补 |
| [improvement-plan.md](improvement-plan.md) | 分层改进计划与 24 天排期 | 2026-10-01 |
| [market-and-differentiation.md](market-and-differentiation.md) | 市场定位、目标人群、差异化、商业路径、反方论证 | 2026-10-01 |
| [solution-selection.md](solution-selection.md) | 方案选型与技术结构决策 | 2026-10-01 |
| [competition-rules-and-data.md](competition-rules-and-data.md) | 比赛规则核对、WHOOP 授权范围、百炼费用 | 2026-10-01 |
| [bailian-agent-setup.md](bailian-agent-setup.md) | 百炼两种传输方式、必需配置、数据校验 | 2026-10-01 |
| [cloudflare-deployment.md](cloudflare-deployment.md) | 部署操作、Worker 变量与 secrets、WHOOP Dashboard | 2026-10-01 |
| [email-auth-setup.md](email-auth-setup.md) | Resend 发信域、密码运维、`AUTH_SECRET` 轮换 | 2026-10-01 |
| [platform-access-checklist.md](platform-access-checklist.md) | 各平台账号配置与实测状态 | 2026-10-01 |
