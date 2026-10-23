# BioTrip 方案选型

**记录日期：2026-09-26**
**选定方向：独立响应式 PWA + 百炼 Managed Agent + 官方 FlyAI Skill + 用户授权的 WHOOP OAuth**

## 1. 产品定位

BioTrip 不是再生成一份完整攻略，而是把 WHOOP 身体状态、旅客自述的疲劳/压力和情绪、对颜色与环境氛围的个人联想，和已有日程放在一起规划。百炼 Agent 先理解这次想获得的感受，再保留预约和用户最想去的地方，优化步行/交通、恢复间隔和场所氛围；服务端校验硬约束，用户预览并确认。体验后的身体和情绪反馈还能改变下一段路线，形成持续的旅程闭环。

这个方向既有可见的旅行场景，也把比赛要求的百炼 Managed Agent、FlyAI 真实旅行数据和完整可体验产品串成同一条手机端闭环。

## 2. 应用外壳

| 方案 | 优点 | 风险/代价 | 结论 |
| --- | --- | --- | --- |
| 独立响应式 PWA | UI、WHOOP OAuth 和百炼调用在一个产品里；可按手机添加桌面优化；不用要求评委先安装另一个应用或插件 | 要自己实现最小行程/状态模型、响应式界面和安装体验 | **采用** |
| TREK + BioTrip 插件 | 可复用现成旅行行程、地图和用户系统；插件能读写宿主行程 | 需要解决宿主账号、移动插件 UI、iframe 高度和许可边界；核心演示依赖另一个部署应用 | 不作为首个 MVP；规则优先后可评估与 TREK 导入/导出 |
| 只在百炼控制台演示 Agent | 符合 Managed Agent 调试步骤，上手快 | WHOOP 授权、可安装 PWA、移动旅程和确认后编辑行程体验不足；难呈现完整产品 | 仅用于 Agent/Skill 调试，不作为最终产品 |

选用自建 PWA 是对原 TREK 插件方案的调整：规则强调百炼 Agent 和 FlyAI 的真实验证，用户明确要完整手机网页应用；独立外壳可直接展示 OAuth、数据说明和确认流程，不需要把产品体验埋在别的应用中。首版行程做完整最小闭环，不重做地图平台或预订交易系统。

## 3. 技术结构

| 层 | MVP 选型 | 设计原则 |
| --- | --- | --- |
| 产品 UI | Next.js App Router + TypeScript，手机优先响应式 PWA | 单一网页产品；安全区、触控尺寸、manifest/图标和缓存壳都纳入验收 |
| 应用 API | Next.js 服务端 Route Handlers | 浏览器只访问同源 API；客户端拿不到 WHOOP/百炼/FlyAI 凭证 |
| WHOOP | OAuth 2.0 + 服务端 WHOOP v2 API 客户端 | 用户授权后按当前行程按需取最新周期和最近 7 天；`read:profile` 仅用于显示连接的是哪个 WHOOP 账号，不进入任何智能体 |
| 百炼 Agent | 三个 Managed Agent + Session/Event API + SSE | 无工具解读 Agent 接收 WHOOP/主观反馈；当地信息 Agent 只收城市与服务偏好；带 FlyAI Skill 的旅行 Agent 只拿旅行条件 |
| 飞猪能力 | 百炼中安装官方 `alibaba-flyai/flyai-skill`，在 Managed Agent 环境安全配置 FlyAI API Key | 遵循比赛指定接入链路；真实搜索由 Agent 使用 Skill，前端和 WHOOP OAuth 服务端均不保存 FlyAI 凭证 |
| 行程规则 | 服务端 TypeScript 校验器 + Agent 结构化建议 | 固定预约/时段/行程 ID 由代码硬校验；模型不可直接写库、下单或覆盖预约 |
| MVP 行程状态 | 单用户、用户主动保存到当前设备 | 不保存 WHOOP 原始指标；当前版本不提供云端账号或云同步 |
| 开发与运行 | GitHub 私有开发仓库；本地可复现启动；再验证免费 HTTPS 部署 | 源码不含密钥/个人健康数据；比赛提交前确保评委能访问仓库 |

百炼资料明确要求 API Key 和 Workspace ID 由服务端携带 Bearer Header，当前 Managed Agent API 地域为 `cn-beijing`。服务端创建 Session、先建立 SSE 订阅、再发送 Event 并等待回合结束；完整会话历史也作为事件保留，因此每个短时 Session 取回结果后请求删除。WHOOP 原始数据只进入无工具的解读 Agent；当地信息 Agent 只获得城市/日期/服务偏好；旅行 Agent 和 FlyAI Skill 只取得缩减后的旅行条件。

### WHOOP scope 决策

完整相关健康指标使用：

- `read:recovery`：恢复评分、HRV、静息心率及可用的恢复测量。
- `read:cycles`：周期负荷、心率、步数等；周期是生理周期，可能不等于午夜切日；`step_count` 可为空。
- `read:sleep`：睡眠时长、阶段、表现与其他可用睡眠评分字段。
- `read:workout`：锻炼负荷和活动数据。
- `read:body_measurement`：WHOOP 可用的身高、体重和最大心率测量。
- `offline`：获取可续期的 Refresh Token，不是健康数据授权范围。

申请 `read:profile` 仅用于在账户页显示连接的 WHOOP 账号名称与邮箱，这两个字段不发送给任何智能体；不批量传送历史数据，规划请求将本次当前周期与近七日范围中实际返回的相关指标传给百炼。WHOOP API 没有独立压力值，`strain` 是生理活动负荷而非心理压力；疲劳/压力等主观感受由旅客自己报告。用户明确同意完整指标发给百炼，但每次连接/生成界面仍需透明展示数据流、数据范围、断开入口和“不是医疗建议”。

### 约束和 Agent 分工

1. API 先从 WHOOP 读数据并构建一次性输入；无效/缺失字段保留为缺值，不填 0。
2. Agent 收到健康指标、旅行偏好和日程，生成固定 schema 的候选动作与理由；也可通过 FlyAI Skill 搜索旅行替代项。
3. Agent 调 FlyAI 时只提供旅行侧筛选项：目的地、日期、类别、预算、移动/无障碍条件、用户选择的氛围标签；不得把 WHOOP 数值、用户姓名或健康原始记录传进 Skill 参数。
4. 服务端验证预约、时间顺序、同一活动不重复、用户 ID 和飞猪结果来源，再给前端差异预览。
5. 用户确认后写入最小行程数据库。未确认、校验失败、拒绝、掉线或工具失败时均不改变原计划。

### 多感官与反馈闭环

用户带入这组灵感来自 GDG / 西岸美术馆现场分享的“感知的边界”与多感官体验资料：颜色、气味、情绪之间的联想；身体感受如何经由界面、记录和算法被理解；体验中的反馈与共同塑造；以及解释可能如何影响人对自己的理解。BioTrip 将它们作为交互设计线索，不把演讲中的探索或有限示例当成医学结论或普适心理定律。

1. **旅前定意图：**“我想平静下来 / 慢慢探索 / 获得活力 / 随心发现”，再选个人喜欢的空间色调和气味、声音、光线、拥挤度偏好或避讳。颜色只作为用户自己表达氛围联想的标签。
2. **当下身体与心情：**WHOOP 提供实际存在的恢复、睡眠、心率、活动负荷等指标；“疲劳”和“压力”由用户自评，可随时修正，不从 HRV 自动推断心理状态。
3. **空间和路线匹配：**路线综合考虑步行距离、坡度/交通和预约约束，也考虑用户选定的安静、绿意、气味刺激少、明亮/柔和等偏好。场所属性来自用户选择或可说明的数据，不让模型凭空断言感官事实。
4. **体验后反馈：**用户用极短反馈记录身体更轻松/更累、心情更平静/更兴奋、喜欢/不喜欢的环境线索。Agent 以此微调下一段；更新长期偏好前由用户选择，偏好可查看、编辑、清除。
5. **可解释呈现：**建议说明“基于你今天选择的慢节奏、这项活动的步行距离和上一站反馈”，避免“算法认定你焦虑/适合蓝色”这类可能影响自我理解的断言。

## 4. 部署和 free-for-dev

比赛强制的百炼资源不是完全免费：Managed Agent 运行中的会话费 0.5 元/小时；模型与工具/MCP 单独计费。官方有 10 小时运行时抵扣，30 天有效；FlyAI 的调用配额是另一套规则。需要做开发会话自动结束，限制工具调用，提交前检查云账单。

应用选择 Cloudflare Workers + vinext，使用 `biotrip.eazylee.si` Custom Domain、HTTPS WHOOP callback 和 Worker secrets。旅行方案只存用户当前设备，WHOOP OAuth 凭据使用加密 HttpOnly Cookie，因此当前单用户版本不需额外数据库保存刷新令牌或行程。Cloudflare Pages 只适用于静态导出，不承载本项目的 OAuth 和服务端 API。

Cloudflare 当前推荐 vinext 作为 Next.js Workers 路径，但 vinext 仍处于 beta。项目兼容性扫描、Worker 构建和 Wrangler dry-run 已通过；生产部署仍需完成 Cloudflare CLI OAuth 授权并注入平台 secrets。部署前后都应查看 Cloudflare、百炼和 FlyAI 实际计费与配额，不假设免费额度或无限运行时。

## 5. 数据安全、开源和提交

- WHOOP 原始指标经用户明确授权发送给百炼无工具解读 Agent；旅行搜索链路只接收旅行筛选条件，不放 GitHub、演示视频或普通应用日志。
- 百炼可能保留 Agent Session 的 Event 历史；每次任务完成后通过 API 删除 Session。删除会话不等于可承诺删除供应商所有后台副本。
- OAuth `client_secret`、refresh token、百炼 API Key、FlyAI API Key 全在服务端密钥管理；仓库只提交 `.env.example` 占位符。
- 应用不将百炼 Agent 输出直接作为数据库写入；结构校验和用户确认分别落实建议安全与最终授权。
- 开发仓库仍是私有。比赛 Issue 要源码仓库链接；没找到指南明确要求 public，但评委必须有访问权限。提交前准备脱敏公开镜像/分支或确认官方可访问的评阅方式。
- 报名条款含个人信息收集、向联合方传递和姓名/肖像/声音/作品宣传授权；没有提交或接受条款。比赛材料不上传核心秘密、凭证、医疗隐私或身份文件。

## 6. 参考资料

- [钉钉参赛指南](https://alidocs.dingtalk.com/i/nodes/QG53mjyd800agdlKHebwk4Zj86zbX04v)
- [飞猪 AI 旅行创新大赛官网](https://opc.aliyun.com/feizhu)
- [百炼 Managed Agents API](https://help.aliyun.com/zh/model-studio/managed-agents-api-overview)
- [百炼 Managed Agents 会话与事件](https://help.aliyun.com/zh/model-studio/managed-agents-session-event)
- [百炼 Managed Agents 计费](https://help.aliyun.com/zh/model-studio/managed-agents-billing)
- [FlyAI 官方 Skill](https://github.com/alibaba-flyai/flyai-skill)
- [WHOOP API 与 OAuth scopes](https://developer.whoop.com/api/)
- [WHOOP OAuth 文档](https://developer.whoop.com/docs/developing/oauth/)
- [WHOOP 开发入门（App、scope 和 redirect URI）](https://developer.whoop.com/docs/developing/getting-started/)
- [WHOOP Recovery](https://developer.whoop.com/docs/developing/user-data/recovery/)
- [WHOOP Cycle](https://developer.whoop.com/docs/developing/user-data/cycle/)
- [WHOOP Sleep](https://developer.whoop.com/docs/developing/user-data/sleep/)
- [free-for-dev 候选目录](https://github.com/ripienaar/free-for-dev)

线上文档最近核对时间：2026-09-26。平台价格、比赛提交页面和开放平台配额可能变化，提交/部署当日再核实。
