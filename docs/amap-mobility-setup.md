# 高德出行顾问接入

高德通过百炼独立出行 Agent 接入调整流程。此能力在 Managed Agent Provider 中启用，缺少配置或真实路线证据时保留基础调整建议。

## 配置 Web 服务与 MCP

在高德创建 Web 服务 Key，保存在百炼高德 MCP 的私密配置中。应用不需要浏览器地图 SDK，也不将 Key 放入前端或 `NEXT_PUBLIC_` 变量。

参考 [高德 MCP 接入](https://developer.amap.com/api/mcp-server/gettingstarted) 和 [百炼 MCP 管理](https://docs.agent.bailian.aliyun.com/zh/mcp/cli)。包含 Key 的 MCP 完整地址属于凭据。

## 独立 Agent

创建专用 Agent 和运行环境，只接入高德 MCP，不挂载 Skill、FlyAI Vault、WHOOP 或旅行记忆。仅允许以下只读工具：

- `maps_text_search`
- `maps_search_detail`
- `maps_direction_walking`
- `maps_direction_driving`
- `maps_direction_transit_integrated`

设置 `BAILIAN_MOBILITY_AGENT_ID`、`BAILIAN_MOBILITY_ENVIRONMENT_ID` 和 `BAILIAN_MOBILITY_MCP_SERVER_ID`，保留已有百炼业务空间配置。MCP ID 应来自实际会话配置。

服务端在提交地点前检查会话权限，拒绝额外工具、未知快照结构或交互式审批请求。

## 路线依据与边界

出行阶段仅接收城市与相邻的公开地点名，不发送 WHOOP、自评或档案，也不获取用户当前 GPS。地点有歧义、跨日或起终点不明确时，不猜测路线。

POI 与坐标通过实际搜索及详情结果关联。路线时长、距离与车费仅从配对的原始工具事件中提取；缺车费不显示数字，模型总结不能作为路线事实。

用户仍需确认才能采用建议。固定预约、行程版本和起点变化约束继续生效。使用独立测试旅程验证“真实工具结果 → 建议卡片 → 确认 → 保存”，见 [验证说明](verification.md)。
