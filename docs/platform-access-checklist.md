# 服务接入

BioTrip 使用 Cloudflare Workers 与 D1 运行应用，通过百炼完成规划与随行对话。配置模板见 [`.env.example`](../.env.example)，本地变量保存在 `.dev.vars`，生产密钥使用 Worker Secrets。

## 账号与存储

- 在自己的 Cloudflare 账号创建 D1 数据库，将绑定名称保留为 `BIOTRIP_DB`，更新 `wrangler.jsonc` 的数据库标识。
- 应用全部 `migrations/` 迁移，保留 `BIOTRIP_PLANNING` Workflow 绑定。
- 设置足够随机的 `AUTH_SECRET`。WHOOP 授权加密使用独立的 `WHOOP_COOKIE_SECRET`。
- 邮箱登录需要 `RESEND_API_KEY` 与通过验证的 `RESEND_FROM_EMAIL`，见 [邮箱配置](email-auth-setup.md)。

## 百炼与 FlyAI

| 配置 | 用途 |
| --- | --- |
| `BAILIAN_API_KEY` | 标准百炼业务空间凭据 |
| `BAILIAN_WORKSPACE_ID`、`BAILIAN_REGION` | 对应业务空间与地域 |
| `BAILIAN_PLANNING_MODE` | `auto`、`managed` 或 `model` |
| `BAILIAN_PLAN_MODEL` | 标准模型 API 的模型名称 |
| `BAILIAN_MODEL_API_KEY` | 可选，单独指定模型 API 凭据 |
| 各 Agent 与环境 ID | 库存、身体解读、当地检索和独立编排 |
| `BAILIAN_FLYAI_VAULT_ID` | 仅向旅行库存会话提供旅行凭据 |
| `FLYAI_API_KEY`、`FLYAI_SIGN_SECRET` | 服务端旅行搜索与签名 |

Agent 配置和执行边界见 [百炼配置](bailian-agent-setup.md)。使用自己业务空间中的资源标识，不能直接使用仓库作者的服务标识。随行对话使用标准模型 API；托管 Agent 的模型在各自配置中管理。

FlyAI 仅执行只读旅行检索。Skill 源码、参考和可导入包位于 [`bailian/`](../bailian/)。独立部署时，应同步修改 Skill 使用的网关域名，并更新 Vault 的出网范围。

## WHOOP

WHOOP 为可选数据源，未连接时仍可使用旅行规划、自评和调整。

1. 创建自己的 WHOOP Developer App。
2. 设置 `WHOOP_CLIENT_ID`、`WHOOP_CLIENT_SECRET` 和 `WHOOP_COOKIE_SECRET`。
3. 将 `WHOOP_REDIRECT_URI` 配为完整的 `/api/whoop/callback` 地址，并在平台登记同一地址。使用本地 vinext 服务时注意端口为 3001。
4. 登记隐私政策地址，按应用请求配置所需权限。
5. 用户在应用中主动连接并完成 OAuth 授权后，才可读取该用户的数据。

沙盒资格、用户额度和发布审核以 WHOOP 控制台为准。

## 高德

高德为可选的独立出行顾问，通过百炼 MCP 接入。配置 `BAILIAN_MOBILITY_AGENT_ID`、`BAILIAN_MOBILITY_ENVIRONMENT_ID` 和 `BAILIAN_MOBILITY_MCP_SERVER_ID`。Web 服务 Key 仅存放在百炼 MCP 私密配置中，见 [高德接入](amap-mobility-setup.md)。

## 验证顺序

先检查邮箱登录与数据持久化，再使用独立旅程验证规划、来源、确认调整和反馈保存。WHOOP 与高德分别验证，避免把配置已填写等同于外部调用成功。命令与范围见 [验证说明](verification.md)。
