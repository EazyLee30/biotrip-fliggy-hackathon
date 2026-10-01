# 百炼与飞猪实时规划配置

生产默认使用 `BAILIAN_PLANNING_MODE=model`。服务端直接调用标准百炼模型 API 与飞猪只读搜索 API，避免由托管 Agent 在沙箱反复执行 CLI。没有有效配置、真实检索或可解析模型结果时，返回错误，不生成示例内容。

## 默认生产方式

需要配置以下 Worker Secrets 与变量：

- `BAILIAN_API_KEY`：标准百炼业务空间 API Key。可用独立 `BAILIAN_MODEL_API_KEY` 覆盖模型调用凭据。两者都不能使用以 `sk-sp-` 开头的 Token Plan Key。
- `BAILIAN_WORKSPACE_ID` 与 `BAILIAN_REGION=cn-beijing`：与标准 Key 一致的业务空间和地域。
- `BAILIAN_PLAN_MODEL=qwen3.7-flash`：明确选择一个可用模型。2026-10-01 控制台核实该模型仍有免费额度，并已开启用完即停。额度和有效期以控制台为准；服务端不会自动切换模型或计费方式。
- `BAILIAN_PLANNING_MODE=model`：默认方式。只有显式改为 `managed` 才使用下述旧托管方式；模型额度不足时不会回退到托管 Agent。
- `FLYAI_API_KEY` 与 `FLYAI_SIGN_SECRET`：真实飞猪密钥与官方 CLI 签名配置，只保存在后台。
- WHOOP OAuth 和账号数据库配置见 `.env.example` 与部署文档。

标准模型端点由业务空间拼接为 `https://{workspace}.{region}.maas.aliyuncs.com/compatible-mode/v1`。当地资料通过 `POST /responses`、`web_search`、`store:false` 检索；行程通过 `POST /chat/completions` 生成。Qwen3.7/3.8 使用严格 JSON Schema，较旧模型使用 JSON Object 并在服务端校验。所有调用关闭长思考、限制输出长度与时限，没有自动重试或悄悄切换模型。

飞猪调用与官方 `@fly-ai/flyai-cli@1.0.16` 一致：`tools/call` JSON-RPC 与 HMAC 签名。签名直接使用真实后台 Key，不再经过“占位符参与签名、Vault 随后替换真实 Key”的冲突。服务端只允许八个官方只读搜索工具。每个勾选的旅行库存类别最多检索一次（全部类别最多五次），无预订、支付和修改订单行为。2026-10-01 单次真实搜索验证：HTTP 200、`status=0`、`message=success`，返回十个商品资料链接。

## 数据与结果校验

`POST /api/plan` 必须同源、已登录，并逐次取得 `consent:true`。可选 `includeWhoop:true` 表示本次使用 WHOOP；省略或为 `false` 时不读取。远期行程不读取今天的 WHOOP 作为未来预测。

临近或进行中的旅程选择 WHOOP 时，后台读取近七天摘要，只在服务器内转为粗粒度的旅行节奏与休息条件。WHOOP 原始指标、自评疲劳/压力数字、身体/情绪反馈原文、账号姓名与邮箱不会进入默认模型或飞猪请求。模型接收行程、抽象节奏、用户偏好及保存的旅行偏好备注；当地资料检索只接收城市、日期、勾选的当地服务类别和饮食偏好。自由填写的行程及备注仍会发送给规划模型，应避免在其中填写无关敏感资料。

当地服务来源必须存在于本次 `web_search_call.action.sources` 中；缺少有效来源的项目会被省略。规划模型选择飞猪来源索引，地点名称与链接由服务器从真实检索结果填入，模型不能自行造链接。固定日程的日期、时间和名称必须完整保留。所有日期、时区、夏令时缺口、抵达顺序和每天覆盖情况均校验；单次最多规划 31 天。

每个账号一次只能生成一份规划，每小时最多十二次。默认总预算为 120 秒；飞猪单次最多 25 秒，当地资料最多 35 秒，行程模型最多 45 秒。取消或断开会中止上游工作，释放账号规划锁。配额不足、鉴权失败、超时、过期版本都有中文错误；不记录密钥、提示词或健康数据。`store:false` 关闭 Responses 会话存储，不代表供应商日志或服务条款中的保留机制被关闭。

校验成功后，服务端将结果保存到当前账号的旅程。已有旅程要求 `journeyId` 与 `expectedVersion`，先验证归属、版本及完成状态，再发起外部调用；生成期间被另一页面修改时，保存会返回版本冲突，不覆盖新内容。`Accept:text/event-stream` 返回阶段进度、十秒心跳与最终完整旅程，普通请求返回 JSON。

## Token Plan 的范围

Token Plan 与标准百炼模型、托管 Agent 的凭据和计量方式不同。官方个人版和团队版均限制在兼容编程/智能体工具内交互式使用，明确排除应用后端。因此 BioTrip 的生产 Worker 不读取 Token Plan Key，也不会把标准百炼调用当作套餐抵扣。

官方依据：[个人版订阅前须知](https://help.aliyun.com/zh/model-studio/token-plan-personal-overview)、[团队版订阅前须知](https://help.aliyun.com/zh/model-studio/token-plan-team-overview)、[Responses API](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-responses)、[Chat Completions](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)、[联网搜索来源](https://help.aliyun.com/zh/model-studio/web-search/)、[结构化输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output)。

## 显式托管 Agent 方式

旧方式仍可通过 `BAILIAN_PLANNING_MODE=managed` 选择，需要完整的三个 Agent、运行环境与旅行 Vault：

1. 健康解读：`BAILIAN_INSIGHT_AGENT_ID` / `BAILIAN_INSIGHT_ENVIRONMENT_ID`。必须没有工具、Skill、MCP 或旅行凭据；逐次选择 WHOOP 后才能发送最近七天数据。服务端创建会话后验证无工具，只接受抽象节奏白名单字段。
2. 当地检索：`BAILIAN_LOCAL_INFO_AGENT_ID` / `BAILIAN_LOCAL_INFO_ENVIRONMENT_ID`。只配置 `web_search`，不接收 WHOOP、身份信息或飞猪凭据。
3. 旅行编排：`BAILIAN_AGENT_ID` / `BAILIAN_ENVIRONMENT_ID` 与 `BAILIAN_FLYAI_VAULT_ID`。挂载仓库的只读 FlyAI Skill，官方 CLI 通过 BioTrip 签名网关搜索，不能执行预订或付款。

托管链各阶段预算为健康 75 秒、当地资料 120 秒、旅行 180 秒，总预算 360 秒。使用后请求删除短时 Agent Session；日志只保留结构与诊断。WHOOP 授权范围和本次健康数据的供应商处理方式与默认模型方式不同，部署切换时必须同步修改页面授权及隐私说明。

2026-10-01 原 `403 AccessDenied` 已确认是 BioTrip 专用标准 Key（ID `7479922`）的自定义权限仅允许模型、拒绝 Agent。经用户明确同意改为该业务空间的“全部”权限后，Agent 资源接口恢复 200。这个修复不能说明模型免费额度仍然可用，也不能让 Token Plan Key 调用托管会话接口。
