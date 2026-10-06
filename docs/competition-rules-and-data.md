# 飞猪 AI 旅行创新大赛规则与 BioTrip 数据流

**核对日期：2026-09-26**  
**依据：**已登录状态下读取钉钉《【参赛指南】2026 飞猪 AI 旅行创新大赛》、飞猪大赛官网和百炼 / WHOOP 官方开发文档。钉钉指南可能需要账号登录。

## 1. 参赛硬性要求

| 项目 | 官方指南要求 | 对 BioTrip 的落实 |
| --- | --- | --- |
| Agent 平台 | 在阿里云百炼创建 Managed Agent，并在平台内调试 | 百炼 Managed Agent 作为产品 AI 核心；PWA 服务端通过 Session/Event API 驱动 Agent |
| 飞猪能力 | 在 Agent 会话中安装官方 Skill：`npx skills add alibaba-flyai/flyai-skill` | 用官方 Skill 搜索旅行商品 / POI；UI 标注真实结果和飞猪链接 |
| 真实数据 | 到飞猪 AI 开放平台申请 FlyAI API Key，在百炼运行环境配置 `FLYAI_API_KEY` 并验证 | 密钥仅配置在 Managed Agent 环境/密钥库；提交前完成真实搜索验证 |
| 代码与提交 | 代码上传到 GitHub，并通过大赛 GitHub Issue 模板提交 | 现有开发仓库是私有仓库；指南要求填写源码链接，但未发现明确写明必须公开。提交前确认评委可读，或准备可访问的脱敏公开仓库 |
| 介绍材料 | 填写项目名称、场景与亮点等说明；演示视频 / 截图为强烈建议材料 | 准备可访问 Demo、约 2–3 分钟核心流程视频、手机截图、README 和运行说明 |

FlyAI API Key 配额（指南当前写法）：未登录访客 300 次总量；注册账号累计奖励 5,000 次，之后每天 100 次；需要更多时联系活动群管理员。开始前以飞猪开放平台当前显示为准。

## 2. 赛程、评分与基本门槛

| 阶段 | 时间 |
| --- | --- |
| 在线参赛 / 提交 | 2026-09-22 至 2026-10-25 |
| 初审 | 2026-10-26 至 2026-11-02 |
| 终审 | 2026-11-03 至 2026-11-06 |
| 颁奖 | 2026-11-07 至 2026-11-15 |

评分权重：创新性 40%（场景精准、AI 核心方案有效，鼓励多模态 / 主动 / 空间计算）；完整度 30%（核心流程跑通、可体验、稳定且可验证）；市场前景 30%（真实高频需求和持续/商业价值）。

官网的获奖说明还列有分数门槛：一等奖 ≥95、二等奖 ≥90、三等奖 ≥85、入围 ≥80；分数线不保证必然产生对应奖项，作品仍需达到相应质量要求。BioTrip 的演示必须让评委看到真实 WHOOP 输入、百炼 Agent 推理、FlyAI 真实结果和用户确认后的行程变更，而不是仅展示聊天窗口。

## 3. 报名与知识产权条款

钉钉参赛指南中的报名说明包含以下授权和保证，提交作品前应逐项读清：

- 报名会收集实名、年龄、身份证号、城市/省份、电话、邮箱，以及项目名称、介绍、平台、开发语言和 AI 使用信息；指南写明会将信息用于资格审核、活动管理、通知，并传给飞猪、联合主办方和支持方。
- 参赛者保证作品原创或已取得合法授权，不侵犯他人知识产权，不伪造材料、不违反法律、公序良俗或伦理规范；相关责任由参赛者承担。
- 指南要求不要提交研发中核心商业秘密或技术秘密。
- 报名授权条款还涉及主办方用于宣传的参赛者姓名、肖像、声音、标识及作品内容；宣传可能包括直播/转播和后续传播，已经发布的活动材料不要求活动结束后撤下。

目前只阅读规则，没有注册、提交材料、接受宣传授权或上传个人证件。开发仓库不放参赛报名资料、WHOOP 原始数据、截图中的个人信息或任何真实密钥。

## 4. BioTrip 的 WHOOP 授权范围

用户已选择“完整 WHOOP 指标也发送给百炼”。据此，MVP 的授权和数据流为：

- OAuth scopes：`read:recovery`、`read:cycles`、`read:sleep`、`read:workout`、`read:body_measurement`。
- 申请 `read:profile` 仅用于在账户页显示连接的是哪个 WHOOP 账号；姓名与邮箱不发送给任何智能体，也不用于行程规划。
- OAuth 同时请求 `offline` 以取得可续期的 Refresh Token；它属于 OAuth 控制 scope，不是健康指标。
- 时间范围：本次规划所需的当前生理周期与最近 7 天，用于当天数据和短期基线；不上传全部历史数据。每次只拉取实际用于当前行程的记录。
- 完整字段范围：恢复分数、HRV、静息心率及 WHOOP 返回的其他恢复测量；睡眠时长、阶段与睡眠评分字段；生理周期的 strain、心率、步数等；锻炼活动及测量数据；身体测量字段。
- WHOOP 授权由用户在 WHOOP OAuth 页面完成；Token 只保存在服务端加密存储，不进入浏览器、日志或 Git。访问 Token 过期时通过 refresh token 更新；用户可断开连接并撤销访问。
- 原始 WHOOP 指标与主观反馈只发送给百炼的专用解读 Agent。该 Agent 必须在百炼中无工具配置；服务端也会检查会话快照的 `agent.tools` 为空后才投递健康数据。结果严格缩减为步行节奏、休息频率和环境筛选条件。
- 独立的当地信息 Agent 接收城市、日期、服务类别与饮食偏好，用百炼联网搜索核实餐饮、放松和医疗服务公开资料；不接收 WHOOP、自评数字和身体/情绪反馈。
- 随后创建第三个百炼旅行 Agent 会话，它配置官方 FlyAI Skill，但只接收行程、当地搜索资料和上述旅行条件，不收到 WHOOP 原始记录、具体指标数值、身份信息或自评数字。不要将“旅行 Agent 的 prompt 约束”说成工具供应商侧的硬隔离；正式部署时还要审查 Agent 工具配置和真实工具调用参数。
- 每次规划按顺序创建短时解读 Session、旅行 Session；每个会话在读取结构化结果后请求硬删除，减少事件历史中的敏感数据留存。删除会话不代表能承诺清除供应商所有后台副本。
- Recovery 可能不存在、仍在评分中或不可评分；不得将缺失值当成 0，也不得声称是医疗判断。出现 `PENDING_SCORE` / `UNSCORABLE` 等状态时如实展示并降级。
- WHOOP 当前公开 API scope/数据模型没有单独的“压力评分”字段。Cycle 的 `strain` 是活动负荷，不等于心理压力；BioTrip 的压力/紧张感通过旅客主动自评收集，与设备指标分开显示。

BioTrip 已注册独立 WHOOP Sandbox 应用并配置回调与全量获准 read scopes，但还未由用户在 BioTrip OAuth 中授权，因此尚未读取 WHOOP 会员数据或传输真实健康数据。应用最多 10 位 Sandbox 成员；升级 Build 需要 WHOOP 审批。

## 5. 百炼接入和费用

比赛强制使用百炼不等于所有客户端请求都从浏览器直连百炼。Managed Agents 官方 API 要求百炼 API Key、工作空间 ID，Agent API 当前地域为 `cn-beijing`；PWA 通过同源服务端调用 `/sessions`、`/events`，并用 SSE 读取回复。每次生成最多使用四个短时 Session：健康解读、当地信息检索（仅所选服务需要时）与旅行库存 Skill 检索并行执行，再用独立会话编排行程；服务端分别请求删除会话。API Key 不可放进前端。

官方计费文档当前写明：运行中的 Agent Session 按 0.5 元/小时收取运行时费；模型 Token 和工具 / MCP 调用另计；总计 10 小时的运行时额度在生效后 30 天有效，且不抵扣模型或工具费。开发时控制并发、完成后结束/删除会话，并在百炼控制台核对账单。FlyAI 配额不等于百炼免费额度。BioTrip 已创建百炼三个 Agent/运行环境并预装 FlyAI CLI，但尚未配置百炼 API Key/FlyAI Vault 或验证真实 API 调用。百炼控制台当前余额为 ¥0.00，百炼联网搜索另按 ¥0.03/次标价，因此本轮没有发起计费搜索。平台计费需在启用当天再次核对。

## 6. 官方来源

- [钉钉《【参赛指南】2026 飞猪 AI 旅行创新大赛》](https://alidocs.dingtalk.com/i/nodes/QG53mjyd800agdlKHebwk4Zj86zbX04v)
- [飞猪大赛官网](https://opc.aliyun.com/feizhu)
- [官方 GitHub Issue 提交模板](https://github.com/modelstudioai/modelstudioai.github.io/blob/main/.github/ISSUE_TEMPLATE/fliggy-ai-travel-innovation-2026.md)
- [百炼 Managed Agents API 总览与鉴权](https://help.aliyun.com/zh/model-studio/managed-agents-api-overview)
- [百炼 Managed Agents 发起会话](https://help.aliyun.com/zh/model-studio/managed-agents-session-event)
- [百炼 Managed Agents 计费说明](https://help.aliyun.com/zh/model-studio/managed-agents-billing)
- [WHOOP API scopes 与接口](https://developer.whoop.com/api/)
- [WHOOP OAuth 2.0](https://developer.whoop.com/docs/developing/oauth/)
- [WHOOP Recovery](https://developer.whoop.com/docs/developing/user-data/recovery/)
- [WHOOP Cycle（含新 `step_count` 字段）](https://developer.whoop.com/docs/developing/user-data/cycle/)
- [WHOOP Sleep](https://developer.whoop.com/docs/developing/user-data/sleep/)
- [WHOOP API 更新日志](https://developer.whoop.com/docs/api-changelog/)
