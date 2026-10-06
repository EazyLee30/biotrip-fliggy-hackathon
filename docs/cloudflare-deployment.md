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
- `BAILIAN_PLANNING_MODE=auto`：库存、当地检索、专用编排 Agent 与 FlyAI 密钥库齐备时优先走百炼托管智能体（比赛要求路径），配置缺失时选择标准模型 API；运行中失败不重跑整个流水线。健康 Agent 单独配置。详见[百炼 Agent 配置](bailian-agent-setup.md)。

WHOOP Client ID 已配置在 Worker vars；以下服务端密钥应写入 Cloudflare Worker secrets。不要写进 `wrangler.jsonc`、Git、命令参数或聊天内容：

- 已配置：`AUTH_SECRET`、`WHOOP_CLIENT_SECRET`、`WHOOP_COOKIE_SECRET`、`BAILIAN_API_KEY`。
- 已核实配置：`RESEND_API_KEY`、`FLYAI_API_KEY`、`FLYAI_SIGN_SECRET`。2026-10-03 通过 `wrangler secret list` 仅回读密钥名称，不读取值。
- 邮箱服务设置见[邮箱登录说明](email-auth-setup.md)。
- 百炼非敏感变量：Workspace ID、区域、四个 Agent/环境 ID 与 FlyAI Vault ID 已在 `wrangler.jsonc` 中配置。
- 2026-10-04 已移除临时 `/api/internal/provider-check` 路由，不再通过线上端点修改 Agent、Vault 或发起计费诊断。历史 `BIOTRIP_DIAGNOSTIC_TOKEN` 不再被应用读取；后续排查使用受控的本地脚本与平台调用记录。

## 数据库迁移

`migrations/` 共 6 个文件。**必须先应用迁移，再部署代码。**

```bash
pnpm exec wrangler d1 migrations list biotrip-users --remote
pnpm exec wrangler d1 migrations apply biotrip-users --remote
```

| 迁移 | 建的表 | 未应用的后果 | 代码是否有降级 |
| --- | --- | --- | --- |
| `0001_accounts.sql` | `accounts` `login_codes` `sessions` `profiles` `trip_shares` | 无法登录 | 无 |
| `0002_password_auth.sql` | `account_passwords` `auth_rate_limits`；`login_codes.purpose` | 无法密码登录；规划租约写不进去 | 无。**已确认应用** |
| `0003_journeys.sql` | `journeys` `journey_feedback` `journey_memories` | 所有旅程接口返回 503，产品不可用 | **无降级** |
| `0004_whoop_connections.sql` | `whoop_connections` | WHOOP 无法跨设备持久化 | 无；D1 是授权的唯一权威，旧 Cookie 不恢复连接 |
| `0005_learned_preferences.sql` | `learned_preferences` | 偏好学习静默失效 | 有，`preferences.ts` 返回空 |
| `0006_preference_kinds.sql` | 扩展 `learned_preferences.kind` | 无法记住密度与守护偏好 | 不降低约束；保留旧记录后迁移 |

2026-10-03 已通过 `wrangler d1 migrations list biotrip-users --remote` 核实全部迁移已应用，返回 `No migrations to apply`。

邮箱验证码通过 Resend 的 HTTPS API 发送，不使用 Cloudflare Workers Email Sending 绑定。发信域使用 `notify.biotrip.ccwu.cc`；在 Resend 中验证该域并按其控制台添加 DNS 记录后，将 API Key 存为 Cloudflare Worker Secret `RESEND_API_KEY`。发件人由非敏感变量 `RESEND_FROM_EMAIL` 设置，当前配置为 `BioTrip <login@notify.biotrip.ccwu.cc>`。Cloudflare Email Routing 可单独用于根域收信转发；它不是登录验证码发信通道。FlyAI API Key 保存在 Worker 后台，并由百炼旅行 Vault 向库存 Skill 注入；Worker 验证请求后用真实 Key 重签官方搜索，避免占位符签名冲突。健康、当地检索与编排 Agent 不绑定飞猪凭据。

BioTrip WHOOP App、百炼 API Key、Resend 与 FlyAI Vault 已配置。2026-10-01 实际调用确认百炼 Key 的模型接口可用；原 Agent `403` 来自 Key 的自定义权限限制，用户确认改为默认业务空间“全部”后 Agent 接口恢复。飞猪凭证只注入旅行 Agent 会话，用户 WHOOP OAuth 授权仍需独立实测。

## WHOOP Developer Dashboard

使用独立的 BioTrip App，不复用目前绑定到 ChatGPT GPT 的 `whooper` App。BioTrip App 已建并登记下列信息：

- Privacy Policy URL：`https://biotrip.ccwu.cc/privacy`
- Redirect URI：`https://biotrip.ccwu.cc/api/whoop/callback`
- Scope：`read:recovery`、`read:cycles`、`read:sleep`、`read:workout`、`read:body_measurement`、`read:profile` 及 `offline`。

Client ID、Client Secret 与 Cookie 加密密钥已配置到 Worker。应用处于 Sandbox（最多 10 位成员）；需要 WHOOP 审批升级 Build 后才能面向更多真实用户。注册 callback 不等于 WHOOP 用户已授权。

## 2026-10-03 部署状态（历史记录）

1. 线上 Worker Version ID：`ab2915ee-8a0e-420b-aa34-efe7f5df05fe`（2026-10-03 部署）；生产域名与 Custom Domain 正常。
2. 健康、当地信息与库存并行准备，完成后进入专用无工具编排 Agent；标准业务空间 Key 调用，Token Plan Key 不用于应用后台。额度及费用以服务商控制台为准。
3. WHOOP OAuth 密钥、百炼四组 Agent/环境、当地检索、Worker Secret、FlyAI Vault 与官方旅行 Skill 均已配置。FlyAI Skill 路径已通过真实行程验证，来源和执行者保存在 provenance。
4. 六个迁移均已应用，默认邮箱密码登录，个人档案提供首次密码设置；首次设置与忘记密码使用邮箱验证码。旧账号、档案和会话保留。
5. WHOOP App 登记为 Sandbox，最多 10 个连接成员。2026-10-03 已验证当前登录真人账号读取成功：`syncStatus:"synced"`、无失败项目，恢复、睡眠、步数与 HRV 均有实际读数。已修复 WHOOP 最后一页 `next_token:null` 被误判异常的问题，不需重复授权。
6. 预约支持“13:00 活动名称”的自然填写，默认固定并绑定抵达首日；明确标记“| 灵活”的活动也传入编排。错误会标明具体行，并在模型调用前拦截。预约主入口已改为日期点选、小时与分钟滚轮、活动与选填地点、固定或灵活选择；旧文本仍兼容。209 项回归通过，320×568、390×844 手机和桌面浏览器核验；底部菜单在页面内切换并保留表单，避免切换触发文档或 RSC 导航。
7. 生成接口支持持续进度与心跳。2026-10-03 已完成独立测试账号的真实单日与三日规划，分别 28.4 秒与 39.8 秒；`source:"live"`、四阶段均 `ok`，三日 FlyAI Skill 搜索返回 30 个来源，保存后重新读取一致。具体样本见 [最终上线验证](bailian-agent-setup.md#2026-10-03-最终上线验证)。

逐条核实步骤见 [project-plan.md 第 3 节](project-plan.md)。

## 2026-10-03 点选输入与预约编辑

生产版本 `a438b108-3029-4dbb-9676-56c1c4ec16aa` 已部署。创建与调整页均可逐项添加、编辑预约，日期限定在目的地实际抵达至结束日期内，时间支持任意小时与分钟滚轮及键盘点选；地点选填，活动名可快捷填写或自由输入。旧预约保持兼容，未确认的修改取消后不写回。探索详情选择真实旅程日期与时间后加入待安排活动，移除了未经核验的可预约时段与拥挤度。

可编辑草稿仍保存至账户；已生成行程的待调整预约仅暂存在当前标签页 sessionStorage，只有原始预约及服务端版本仍匹配才恢复，重新规划成功后保存到账户并清除暂存，显式保留当前行程会撤销暂存。暂存不含身体记录或凭据。疲劳、压力提供可清空的五档点选与横向滑动，纵向滚动不误选；身体感受、饮食及记忆偏好支持常用表达点选与自由补充，常住城市使用现有搜索与拼音索引选择器。

手机弹层独立滚动，顶部下拉关闭，固定确认栏适配小屏与 visualViewport；时间滚轮尚未停止时禁止确认。209 项回归、类型检查、相关 ESLint（无错误，8 条既有警告）、生产构建及部署通过；浏览器验证了预约保存后重读、已生成行程待调整预约刷新恢复、取消不覆盖原文、短拉回弹、长拉关闭、等级横滑/纵滑分辨、自由文字与常用表达保留、320px 无横向溢出及底部确认可见。本次没有追加模型生成调用。


## 2026-10-03 活动编辑、分享与生成期间推荐

生产版本 `ab2915ee-8a0e-420b-aa34-efe7f5df05fe` 已部署。今日节点、每日安排、身体指标及探索介绍均接入详情入口；每日行程编辑支持同日灵活活动的长按拖动、桌面拖动、上下移点选，以及日期、任意时分、名称、说明和固定标记的修改。保存只更新账户中的行程，不调用模型；排序保留固定活动及原时间档位，显式编辑预约同步原预约草稿。新增保护的活动会加入后续规划使用的固定安排。未保存的预约通过三方合并保留，版本冲突和生成中的账户锁会拒绝覆盖。

分享恢复预览、创建、复制、系统分享与撤回。默认公开目的地、简介与安全来源；用户另行选择并确认后才包含每日活动。预览与服务端使用同一快照函数，分享必须来自账户所属的当前版本行程，匿名内容提交和过期版本被拒绝，不附带原始身体记录或个人档案。

生成期间复用原有并行检索：每个检索阶段完成就通过 SSE 推送公开推荐，最多 20 条、按 URL 去重，用户可横向浏览与打开详情及来源。取消后停止推送，未返回真实资料时显示等待状态。推荐不新增模型或搜索调用。

240 项回归、类型检查、相关 ESLint（无错误，2 条既有登录跳转警告）、生产构建及部署通过。浏览器验证了取消不写回、编辑与排序保存后刷新重读、固定活动修改同时保留新增待安排预约、分享页面、复制反馈及撤回失效；320×568 小屏无横向溢出，确认按钮位于屏幕内。桌面原生拖动和列表边缘自动滚动已验证；iPhone 的真实触摸长按及系统分享面板尚未在实机验收。

本次独立测试账号的一次线上单日真实生成用时 44.2 秒，17.2 秒先返回 10 条飞猪商品来源、29.1 秒补充 4 条当地公开资料。行程保存重读、手动修改、过期版本拒绝、两种分享快照和撤回均通过；测试旅程及分享已清理。该时长是单次样本，不是所有行程的耗时保证。


## 2026-10-04 持久任务发布

当前生产版本 `1167b26a-2caa-4ba4-b68c-901939b3cad4`，迁移 `0007_planning_jobs.sql` 已应用。完整执行与验收状态见 [执行记录](zen-product-execution.md#2026-10-04-后台生成候选确认与版本历史)。

发布顺序：先 `wrangler d1 migrations apply biotrip-users --remote`，再 `npm run build:vinext` 与 `npm run deploy:vinext`。入口为 `src/workers/app.ts`，必须保留 `PlanningWorkflow` 导出、`BIOTRIP_PLANNING` Workflow 绑定以及 `BIOTRIP_DB`。定时清理为每小时第 17 分钟。保留 `nodejs_compat_populate_process_env` 使后台复用已有模型与 WHOOP Secret；不把密钥复制到源码或浏览器。

Workflow 与应用在同一 Worker 发布，但执行不依赖前端请求。新客户端通过 `/api/plan/jobs` 提交、按序号读取；已有安排的重新生成需要确认候选，历史从 `/api/journeys/[id]/versions` 读取和恢复。旧 SSE 入口共享账号锁，以兼容旧页面。

回退只回退 Worker 版本，保留新表和用户版本历史；回退前先检查执行中的任务，避免旧前端失去查看入口。后台任务七天过期清理，保存的行程历史保留最近 30 次。真实 WHOOP 原始指标不存入阶段快照。


## 2026-10-04 活动标识与组件拆分发布

当前生产版本 `6eefc05b-3ccb-4f31-977d-a66776b4cfe4`，本批无需新增迁移。活动标识在旧记录读取时确定性补充、保存时持久化；新的编辑请求核对标识与位置，候选与版本历史按标识比较。新客户端资源已随完整部署更新，不能只上传服务器模块并保留旧客户端素材。

267 项测试、类型检查、无警告 lint、生产构建通过，线上测试账号的编辑、刷新、错误标识拒绝、历史恢复与清理通过；未新增模型和 WHOOP 调用。进一步状态拆分、照片许可与真机手势仍按 [执行记录](zen-product-execution.md#2026-10-04-活动身份与首批组件拆分) 跟进。

## 2026-10-04 创建与身体节奏页面拆分发布

当前生产版本 `3180e8cf-aebc-4cca-81bf-bfb4d700d93e`，通过完整 `build:vinext` / `deploy:vinext` 发布，未新增迁移。创建、身体节奏、睡眠与即时休息页面及表单输入状态已抽取；增加小屏输入字号、长文本换行与短视窗弹窗布局。候选生成按钮明确提示需确认才更新。

267 项测试、类型检查、无警告 lint、生产构建通过。本地创建回退与输入保留、睡眠返回父层、四档宽度及短视窗编辑通过；线上首页及样式资源 200、匿名后台任务 401、诊断接口 404。未新增模型、飞猪搜索或 WHOOP 身体数据调用。原始素材回执、真实照片授权及真机体验仍待验收，详见 [执行记录](zen-product-execution.md#2026-10-04-创建与身体节奏视图拆分小屏布局)。

## 2026-10-04 导航与进度读取控制发布

当前生产版本 `4940a7d6-db4e-4fbc-8d2c-91699895f1b6`，完整构建与静态资源部署，无迁移。导航控制和后台任务轮询已抽取，修复停止等待后迟到响应仍可能切页的问题。保存、任务提交、候选采用及版本校验契约保留。

271 项测试、类型检查、无警告 lint、构建通过；浏览器返回父层、功能入口回顶部、四档宽度及模拟 150% 文字放大通过，只读夹具验证迟到完成结果不切页。生产首页与静态资源 200、匿名任务 401、诊断接口 404。未调用真实模型、飞猪搜索或 WHOOP 身体记录。进一步账户控制拆分及真机验收见 [执行记录](zen-product-execution.md#2026-10-04-导航控制与后台进度读取拆分)。

## 2026-10-04 草稿保存控制发布

当前生产版本 `f06b1b31-c75d-42a3-be2c-c579509feb8c`，完整构建与资源部署，无迁移。草稿保存队列抽取，移除可能跳过旧内容恢复保存的历史指纹缓存；后台任务恢复切换旅程使旧保存失效，迟到响应核对会话及旅程身份。保留服务端当前版本校验和正式安排保护。

279 项测试、类型检查、无警告 lint、构建通过。本地 QA 浏览器验证保存失败阻止离开、重试成功、重复保存不递增版本、改回旧内容重新保存；临时测试草稿删除 200。生产首页及四项客户端资源 200、匿名后台任务 401、诊断接口 404。没有新增模型、飞猪搜索或 WHOOP 身体数据调用，详细边界见 [执行记录](zen-product-execution.md#2026-10-04-草稿保存控制拆分与切换保护)。

## 2026-10-04 图文卡片与飞猪商品主图发布

当前生产版本 `ffde3533-4da2-4720-b792-f15b3fafd2ef`，完整前后端构建与部署，无迁移。飞猪同一商品对象的 `picUrl` 作为可选 `imageUrl`，经公开 CDN 地址校验后贯通搜索提取、后台推荐、保存地点、发现与详情展示。模型自带图片字段不采用，旧行程缺图保持兼容，不自动为补图重新调用模型或商品搜索。

282 项测试、类型检查、无警告 lint、构建通过。浏览器只读夹具使用此前真实商品回执验证两张图片加载及卡片/详情配对；发现页四档宽度和缺图兜底通过。修复等待推荐容器撑宽、按钮无法滚动的问题，390px 页面保持同宽且推荐区域可横向滚动。详细来源与验证边界见 [执行记录](zen-product-execution.md#2026-10-04-图文展示与飞猪真实商品图)。

本版线上首页与客户端模块返回 200，匿名后台任务返回 401。

## 提交与旅程控制收尾（2026-10-04）

当前生产版本 `65fc0cf9-95e5-426f-a618-5981a21dff09`，完整前后端部署，无迁移。修复明确拒绝仍重发生成请求、删除当前旅程残留选择与保存引用、账户迟到刷新覆盖新修改；候选及历史操作统一锁与旅程会话检查。288 项测试、类型检查、无警告 lint、构建通过。生产首页及客户端模块 200、匿名后台任务 401。没有新增模型或商品搜索调用；详细边界见执行记录。

## 等待推荐分批交付（2026-10-04）

当前生产版本 `88d05d3c-a73f-45f3-bff6-6e2adddd8f09`，完整部署，无迁移。Skill 和 Worker 的每项经过核验的搜索完成后立即发布新增商品，持久事件和最终输出去重；不增加搜索或模型调用。推荐提前展示、详细步骤折叠。292 项测试、类型、lint、构建通过；长行程和大字号布局压力验证通过，真机验收仍未完成。


## 许可照片与分享容错（2026-10-04）

当前生产版本 `d53e1977-b12b-4d5e-b9f9-a6c497132f1c`，完整部署，无迁移。杭州实景 CC0 照片接入旅程、公开分享与海报，新增 `/credits`；来源、原图和许可文本归档并校验指纹。系统分享增加连点保护、取消处理和能力失败回退。299 项测试、类型检查、lint、构建通过；本地 QA 分享发布、PNG 下载、公开页及撤回通过。线上首页、许可页、照片和客户端模块 200，匿名任务 401。实体设备未连接，真机验收仍待完成，详见执行记录及真机验收表。


## 发现页来源分区（2026-10-04）

当前生产版本 `f452ef2f-3846-4db9-86ba-2176c48f2135`，无迁移。飞猪商品为默认入口，当地资讯独立展示，不再给资讯添加商品预订措辞或重复氛围图；旧旅程数据保留。299 项测试、类型、lint、构建及四档响应式浏览器验收通过。详情见执行记录。


## 生成完成保留浏览（2026-10-04）

当前生产版本 `4bb164ae-f083-4cf5-93a9-9d5e813993ef`，无迁移。首次完成保存后保留推荐与详情，由用户点击查看行程；调整完成不自动弹确认，由用户打开待确认方案。299 项测试、类型、lint、构建通过，浏览器完成与待确认两条路径验证通过。详见执行记录。


### 2026-10-05 旅行杂志与导航收尾

最新线上版本 `3fddeb59-35ca-4577-8d52-81b817ccf25f`，无迁移。紧凑首页、持续任务条、历史返回与弹窗导航顺序、三步分享及明信片/手记、活动来源引用、私有任务耗时观测和我的分组。首页/氛围图片 200，匿名任务接口 401，被否决城市候选资源 404。304 测试、类型、lint、构建通过；详细验证及真机待验见 zen-product-execution.md。


## 2026-10-05 高德出行与调整流程发布

生产版本 `c0d6d885-ca1f-40cb-8084-a3930ef86553` 已通过 `deploy:vinext` 发布完整前后端，保留现有 secrets，新增独立高德 Agent / 环境 / MCP 配置。远程迁移 `0008_adjustments.sql` 已成功，Workflow 和定时任务绑定已确认。上一版本 `3fddeb59-35ca-4577-8d52-81b817ccf25f` 留作回滚参考；新增 schema 与旧代码兼容，不需要删除字段或表。

本地真实 Session、原始 SSE、高德建议采纳与版本保存通过；351 项测试、类型、定向 ESLint、构建和 diff 检查通过。线上首页、许可页及四项样式资源 200，匿名任务/状态接口 401，旧诊断接口 404，浏览器登录页正常；远程数据库无待执行迁移。线上没有重新运行真实路线会诊。详见 [高德接入验收](amap-mobility-setup.md)。
