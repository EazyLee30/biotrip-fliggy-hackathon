# BioTrip 改进计划

> 这是 2026-10-01 的历史规划与基线，不代表当前运行状态。2026-10-04 的已实现改版、验证结果和未完成事项见 [明亮旅行手记执行记录](zen-product-execution.md)；当前总状态见 [project-plan.md](project-plan.md)。保留原分析用于追溯，不把“43 项测试”“从未真实生成”等旧判断当作当前结论。

**制定日期：2026-10-01**
**基线：commit `263d726`**（`tsc` 0 errors · `pnpm test` 43/43 · `pnpm lint` 2 errors / 5 warnings）
**约束：提交截止 2026-10-25，共 24 天。初审 10-26。**

当前状态与阻塞项的完整记录见 [project-plan.md](project-plan.md)。本文只讲**接下来做什么、按什么顺序、为什么是这个顺序**。

---

## 判断依据

代码质量已经不是短板。三轮审查中报出的 P0/P1 问题（类型错误、测试跑不起来、偏好学习的 TDZ 崩溃、隐私页错误声明、文档与代码相反、锁泄漏、限流 SQL 列数错误、信息泄露端点、411 行孤儿代码）已在 `7e16b18` 和 `263d726` 中全部修掉。

短板换成两件事：

1. **产品从未真实跑通过一次**，而线上版本还落后仓库两次提交、D1 迁移状态未知。这直接威胁"完整度 30%"和参赛资格。
2. **创新性 40% + 市场前景 30% = 70% 的分数**，其中市场前景此前完全没有文档支撑（已补 `market-and-differentiation.md`），创新性的"主动"维度尚未实现。

所以排序原则是：**先让它真的能跑，再让它讲得出故事，最后才是让它跑得更快、更干净。**

---

## Tier 0 — 让它真的能跑

> 里程碑：**一次真实端到端规划成功，`source:"live"`、`provenance.stages` 全 `ok`、`flyai.sourceCount > 0`，JSON 与截图存档。**

| # | 事项 | 负责 | 工作量 |
| --- | --- | --- | --- |
| 0.1 | `wrangler d1 migrations list biotrip-users --remote` 查已应用迁移；补应用 `0003`/`0004`/`0005`。**先迁移，后部署** | 你 | 15 分钟 |
| 0.2 | `wrangler secret list` 确认 `RESEND_API_KEY`；Resend 控制台确认 `notify.biotrip.ccwu.cc` DNS 验证；实测发一封验证码 | 你 | 30 分钟 |
| 0.3 | 百炼控制台确认：余额、`qwen3.7-flash` 免费额度、Managed Agent 10 小时运行时额度剩余与到期日、三个 Agent 的模型权限 | 你 | 20 分钟 |
| 0.4 | **在百炼控制台手工跑一遍三个 Agent**，不要拿生产 Worker 当第一次调试 | 你 + 我准备提示词 | 1 小时 |
| 0.5 | 重新部署（`build:vinext` → `deploy:vinext`），记录新 Version ID。⚠️ 部署后 `BAILIAN_PLANNING_MODE=auto` 生效，首次真实规划走 Managed Agent 计费 | 你 | 20 分钟 |
| 0.6 | `/api/internal/provider-check`：`action=upstream` 验签名链路 → `action=probe` 验 managed 全链路 | 你触发 | 30 分钟 |
| 0.7 | 你本人完成一次真实 WHOOP OAuth 授权，核对授权页 scope 与 `/privacy` 一致 | 你 | 15 分钟 |
| 0.8 | 跑通一次完整 `POST /api/plan`，存档结果 | 一起 | 1 小时 |
| 0.9 | **验证未连接 WHOOP 时的完整体验**（评委连不上自己的设备，Sandbox 只 10 名额）；准备 1 个已连接的演示账户 | 我 + 你 | 半天 |

**Tier 0 不完成，后面所有工作都是在优化一个未被证明能运行的东西。**

---

## Tier 1 — 让评委能看到

| # | 事项 | 工作量 | 说明 |
| --- | --- | --- | --- |
| 1.1 | **删除 `/api/internal/provider-check`**，或至少删掉 `tune`（改 Agent system prompt）和 `bridge`（改 Vault credential）两个 action | 20 分钟 | 注释自称 "Temporary"。公开仓库里放一个能改云端配置的端点是评审减分项。**在 Tier 0 的 0.6 用完之后再删** |
| 1.2 | `public/design/`（856KB）清理：只有 `profile_zen_modern-2.jpg` 和 4 个 `jakarta-*.ttf` 被生产引用，其余 11 张移出 `public/`；字体路径从 `/design/` 改到 `/fonts/`；**TTF 转 woff2**（250KB → ~100KB） | 1 小时 | 手机首屏直接受益 |
| 1.3 | 删 create-next-app 残留：`public/{file,globe,next,vercel,window}.svg` | 5 分钟 | |
| 1.4 | 补 Plus Jakarta Sans 的 **SIL OFL 1.1 LICENSE** | 10 分钟 | 比赛要求不侵犯他人知识产权；`bailian/flyai-search-skill/LICENSE` 已经放了，字体没放 |
| 1.5 | `stitch_biotrip_terminal/`（12 个 `code.html` + 12 张 `screen.png`）移到 `docs/design-exploration/`，README 一句话说明；或从提交分支剔除 | 20 分钟 | 否则评委分不清产品与设计稿 |
| 1.6 | **决定仓库可见性**（现在私有，Issue 要填源码链接）。若转公开，先审 `wrangler.jsonc` 与 `platform-access-checklist.md` 里的 ID 是否愿意公开 | 你决定 | 非 secret，但公开后可被用于构造请求 |
| 1.7 | 演示视频 2–3 分钟 + 真机截图 | 半天 | 你操作手机，我写分镜脚本 |
| 1.8 | **加 GitHub Actions CI**：`tsc + test + lint + build`，README 挂 badge | 30 分钟 | README 和 `/privacy` 都宣称"隐私边界由断言守护"，但目前没有任何机制自动执行它。CI 绿标是"可验证"最便宜的外部证据 |

---

## Tier 2 — 让它跑得快

`compose_plan` 占整条链路 **70–85% 墙钟时间**（5 天行程约 2,900–3,600 output tokens → 75–90 秒）。按性价比排序：

| # | 事项 | 工作量 | 收益 | 风险 |
| --- | --- | --- | --- | --- |
| 2.1 | **input 裁剪**：① `prompts.ts` 的 `composePlanPrompt` 把 `fixedItems` **序列化了两次** —— 一次在"本次固定项：`JSON.stringify(fixedItems)`"这句说明文字里，一次在 `行程请求` 对象的 `itinerary` 字段里，去掉其中一次；② `flyaiInventory` 收满 30 条 source（`if (sources.size < 30)`），但 `schema.ts` 的 `places.maxItems = Math.min(8, sourceCount)` —— **最多只会用 8 条**，裁到 12 条并在 provenance 加 `sourcesConsidered`/`sourcesUsed` 诚实披露 | **1 小时** | input 降约 40%，**省 10–20 秒** | 极低 |
| 2.2 | **前端渐进呈现**：SSE 已有 `progress` + 10 秒心跳，但行程要等全部完成才显示。在 `compose_plan` 阶段流式转发已解析的 itinerary 项作为"生成中预览"（**必须标注未校验**），完成后替换为最终版 | 半天 | **感知延迟大幅下降** | 低。预览不标注未校验会违反"不让未核验读起来像已核验"原则 |
| 2.3 | `profile/page.tsx` 的 `next/image` 用了 `unoptimized`，72KB 原图直出 → 配合 1.2 处理 | 15 分钟 | 中 | 低 |
| 2.4 | **`compose_plan` 按天并行**：两阶段（日骨架 ~300 tokens/8s → N 天并行填肉 ~600 tokens/20s）。总时长约 110s → 55s，**约 2×** | **1.5–2 天** | 高 | **高**，见下 |

### 2.4 的代价清单（决定要不要做之前先看这个）

需要改的校验：
- `parsePlan` 的固定项比对从全局改为按天，且要校验落在骨架指定的那一天
- `INCOMPLETE_TRIP_DAYS` 改为每天独立校验 ≥1 项；**任一天失败即整单失败**（不能把残缺行程当完整行程）
- `places.source_index` 每天用子集索引，需重映射回全局，否则 `UNVERIFIED_SOURCE_URL` 会误报
- 抵达时间校验只对首日做
- `provenance` 需要能表达"6 次模型调用"而不是 1 次

新增的风险：
- **跨天连贯性**：第 3 天下午突然跳到城市另一端。骨架阶段能缓解不能消除，需要一条"连贯性不足时整单重试或降级为逐日建议并明示"的规则
- **失败率放大**：现在 1 次调用失败 = 整单失败；改完 6 次调用，单请求成功率 p 时整单成功率 p⁶。p=0.95 → 0.735。必须配整单重试或单日重试
- **限流**：6 个并发请求，需确认所用 Key 的 RPM/TPM

⚠️ **2.4 只在缓冲期充足时才做。绝不能压在提交前一周。**

---

## Tier 3 — 让它经得起看

| # | 事项 | 说明 |
| --- | --- | --- |
| 3.1 | **lint 2 errors**（行号为基线 `263d726` 的 lint 输出）：`planner-dashboard.tsx:145` setState in effect（级联渲染）；`:204` React Compiler **无法保留手写 memoization → 整个组件被跳过优化**（推断依赖 `journey?.draft` vs 手写 `[plan, journey?.draft.trip?.arrivalLocal]`）。5 warnings：`:198`/`:275` exhaustive-deps、`:42` `window.location.assign`、`profile/page.tsx:24` `PREFERENCE_GROUPS` + `:67` `whoopMember` 未使用。**注意 `PREFERENCE_GROUPS` 与 `planner/blocks/learned-preferences.tsx` 的 `KIND_LABELS` 是同一份中文标签的两份副本，应删除前者而不是让 lint 闭嘴** |
| 3.2 | **`planner-dashboard.tsx` 407 行巨型组件，单行常超 1500 字符。** 上一轮删掉的 `use-planner.ts`（411 行）方向是对的，只是没接线。**重做抽取并真正接进去**，顺手解决 3.1 的全部 hooks 报错 |
| 3.3 | 🔒 **FlyAI 桥的凭据设计**（managed 成为主路径后风险升级）：`/api/flyai/mcp` 的唯一鉴权是"请求头 Bearer == `FLYAI_API_KEY`"，意味着**真实 FlyAI Key 会离开 Worker、进入百炼 Agent 沙箱、再以 HTTP 头形式回到 Worker**。改为：**Vault 里存一个专用 bridge token（不是真实 Key）**，Worker 校验 bridge token，真实 Key 只留在 Worker Secret、永不进沙箱。CLI 的签名反正会被 Worker 重签，Vault 里放什么值不影响正确性。这样即使 Agent 被提示注入诱导 `printenv`，泄的也只是一个可轮换的桥接令牌 |
| 3.4 | `worker-configuration.d.ts`（15,806 行，`wrangler types` 生成）已入库但被 eslint ignore。**入库 / gitignore 二选一，要一致**；若入库，README 写明如何重新生成 |
| 3.5 | CSS 分散在 `globals.css`(1015 行) + `zen-dashboard.module.css`(220) + `account.css`(137) + `status-page.css` + `share.css`，命名体系不统一（`styles.*` 与 `bio-*`/`account-*` 全局类混用） |

---

## Tier 4 — 让它讲得出故事（**70% 的分数在这里**）

| # | 事项 | 工作量 | 说明 |
| --- | --- | --- | --- |
| 4.1 | ✅ **已完成**：[market-and-differentiation.md](market-and-differentiation.md) | — | 市场前景 30% 的支撑材料，含反方论证与待核实清单 |
| 4.2 | **补上"主动"维度**（创新性 40%） | 半天 | 规则原文鼓励「多模态／**主动**／空间计算」，目前全是用户点按钮。最低成本做法：`journey.status === "active"` 且 `actualDay` 命中今天时，打开 PWA 直接落在今日视图并给出**一条基于昨天反馈 + 今天身体记录的主动建议**。数据已在 `feedbackHistory` 和 `health` 里，只差一次生成 |
| 4.3 | **把呼吸练习闭环显性化** | 2 小时 | `BreathingSession` 完成后已经会自动写 feedback（`sendFeedback("完成了一次 3 分钟舒缓呼吸练习。", true)`），**"主动干预 → 身体反馈 → 影响下一段行程"这个闭环是很强的创新点，但它藏在二级导航**。应在今日视图显眼处呈现 |
| 4.4 | **把已有的 provenance 多兑现一次**（完整度 30%） | 半天 | `provenance` 已存进 `plan_json`，但目前只有 `ProvenanceBlock` 在"今日"视图渲染了一次。可以：探索页每个 place 卡片显示"来自第几次搜索／哪一类"；分享页显示"本行程基于 N 条飞猪实时来源"；`ProvenanceChip`（已实现但未被使用）可以用在头部或卡片上。**数据已在手里，纯展示层工作** |
| 4.5 | **把"可验证"变成外部证据** | 1 小时 | 配合 1.8 的 CI badge；在 README 加一节"如何验证本项目的真实性主张"，列出 `grants.test.mjs` 的 10 条断言分别守什么 |

---

## 排期（24 天）

| 周 | 日期 | 内容 | 里程碑 |
| --- | --- | --- | --- |
| **W1** | 10-02 ~ 10-08 | Tier 0 全部 + 1.1 / 1.2 / 1.3 / 1.4 | ✅ **一次真实端到端规划成功并存档** |
| **W2** | 10-09 ~ 10-15 | Tier 4.2 / 4.3 / 4.4 / 4.5 + 1.8 CI + 3.1 / 3.3 | ✅ CI 绿、主动建议上线、仓库可见性确定 |
| **W3** | 10-16 ~ 10-22 | Tier 2.1 / 2.2 / 2.3 + 3.2 组件拆分 + 1.5 / 1.7 | ✅ 演示视频完成 |
| **缓冲** | 10-23 ~ 10-25 | 提交 Issue + 全量复查 + 报名条款逐条核对。**只有缓冲充足才做 2.4** | ✅ 已提交 |

---

## 明确不做（24 天内）

- ❌ 接入 `decision-model-preview`：最大输出长度为 0，无法生成行程；Token Plan 明确排除应用后端；且 `health_insight` 与 `local_research` 并发，不在关键路径上，替换它对总时长收益约等于 0。详见 2026-10-01 的评估结论。
- ❌ 接入 WHOOP 以外的可穿戴设备：需要抽象 `WearableProvider` 接口，工作量与收益不匹配。**作为路线图写进提交材料即可。**
- ❌ 云端多设备实时同步、协作行程、地图可视化：超出最小闭环。
- ❌ 预订/支付/订单修改：产品立场明确排除，且比赛规则不允许。
- ❌ TREK 插件方案：`solution-selection.md` 已论证不作为首个 MVP。
- ❌ 任何"演示数据 fallback"：违反项目最核心的原则。

---

## 风险登记

| 风险 | 概率 | 影响 | 应对 |
| --- | --- | --- | --- |
| 百炼余额/额度不足，无法真实演示 | **高**（余额 ¥0.00） | 致命 | 0.3 先确认；必要时充值；`bailian-agent-setup.md` 已记录"额度不足时明确报错，不退回演示数据" |
| Resend 域名验证不通过，线上无法注册 | 中 | 致命 | 0.2；Plan B 是预置密码的演示账户 |
| D1 迁移未应用，旅程接口全线 503 | **中**（状态未知） | 致命 | 0.1，**先迁移后部署** |
| WHOOP Sandbox 名额/审批限制评委体验 | **确定** | 高 | 0.9：无 WHOOP 也要完整可用 + 演示视频承载 |
| Managed Agent 运行时费超预算 | 中 | 中 | 0.3 确认 10 小时额度；开发期用 `BAILIAN_PLANNING_MODE=model` 钉住兜底路径 |
| vinext / Next 16 均为 beta，部署链路脆 | 中 | 中 | `pnpm-lock.yaml` 已入库；每次部署前 `build:vinext` 本地验证 |
| 与并行开发会话冲突 | **已发生多次** | 中 | 动手前 `git status` + 文件 mtime 检查；改动后立即提交 |
| 提交前才发现报名条款不可接受（含身份证号、姓名/肖像/声音宣传授权） | 低 | 高 | W1 内读完条款，不要拖到最后一周 |
