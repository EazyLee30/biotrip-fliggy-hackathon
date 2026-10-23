# 百炼与飞猪规划配置

百炼用于 BioTrip 的运行时规划与随行对话。Provider 实现在 [`src/lib/planning/providers/`](../src/lib/planning/providers/)，两种传输方式共用规划流程与结果校验。

## Provider 选择

| 模式 | 行为 |
| --- | --- |
| `auto` | 托管库存、当地检索、编排与 FlyAI Vault 配置齐备时使用 Managed Agents，否则选择标准模型 API |
| `managed` | 仅使用托管智能体，配置不完整时报错 |
| `model` | 使用标准模型 API |

Provider 在任务开始时选择。上游运行失败不会悄悄更换 Provider 并重跑整条流水线。

## 服务端配置

- `BAILIAN_API_KEY`：标准百炼业务空间 API Key。
- `BAILIAN_WORKSPACE_ID`、`BAILIAN_REGION`：与凭据对应的业务空间与地域。
- `BAILIAN_PLAN_MODEL`：标准模型 API 配置，仓库当前使用 `qwen3.7-flash`。托管 Agent 的模型由各 Agent 自身配置决定。
- `BAILIAN_MODEL_API_KEY`：可选，用于分离标准模型 API 和托管 Agent 的凭据。
- `FLYAI_API_KEY`、`FLYAI_SIGN_SECRET`：服务端 FlyAI 只读搜索凭据。

应用使用标准 API 凭据，不使用 Token Plan Key。可用模型、额度和计费以自己的百炼业务空间为准。

## 托管 Agent 分工

| 角色 | 环境变量 | 权限 |
| --- | --- | --- |
| 库存检索 | `BAILIAN_AGENT_ID`、`BAILIAN_ENVIRONMENT_ID` | 只读 FlyAI Skill 与旅行 Vault |
| 身体解读 | `BAILIAN_INSIGHT_AGENT_ID`、`BAILIAN_INSIGHT_ENVIRONMENT_ID` | 无工具、Skill、MCP 和旅行 Vault |
| 当地资料 | `BAILIAN_LOCAL_INFO_AGENT_ID`、`BAILIAN_LOCAL_INFO_ENVIRONMENT_ID` | 公开资料检索，不接收 WHOOP 原始记录 |
| 独立编排 | `BAILIAN_COMPOSE_AGENT_ID`、`BAILIAN_COMPOSE_ENVIRONMENT_ID` | 无工具会话，组合已核验来源与旅行节奏 |

为库存会话设置 `BAILIAN_FLYAI_VAULT_ID`。导入 [`biotrip-flyai-search.zip`](../bailian/biotrip-flyai-search.zip) 前，应检查 [`Skill 源码`](../bailian/flyai-search-skill/SKILL.md) 中的域名与服务配置是否对应自己的部署。

服务端通过 Session 与 Event API 执行任务，在发送敏感上下文前核对受限 Agent 的实际会话配置。会话清理失败会进入后续重试队列。

## 输入与输出

输入包含城市、日期、旅行偏好和已确认的日程约束。只有本次明确允许时，才读取 WHOOP 或记忆。身体原始记录进入专用解读环节，转换为旅行节奏条件；旅行查询使用公开旅行条件。

输出为带来源的行程方案或调整建议。服务端校验结构、日期、来源引用、固定安排和版本；用户确认后才更新旅程。价格、图片、链接与路线数字不能由模型补写为真实检索结果。

## 随行对话

助手通过标准模型 API 和受限工具循环查询旅程、管理清单与提出操作。记忆使用设置和当次隐私要求在服务端再次校验。行程变更需要用户确认，消息与操作结果持久保存在 D1。

实现概览见 [系统设计](architecture.md)，复现与验证见 [验证说明](verification.md)。
