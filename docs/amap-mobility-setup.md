# 高德出行顾问接入

代码已接入调整任务的独立 `mobility` 阶段，与身体解读、舒缓货架及当地检索并行。高德 Web 服务 Key、百炼官方 MCP、独立 Agent / 环境已创建。百炼控制台及应用端真实 Session、SSE 路线查询均已通过；本地完整调整流程已显示真实高德建议；缺少配置时明确降级，基础建议保持可用。

## 1. 高德 Key

高德控制台的 `BioTrip` 应用已创建，类型为旅游。账号持有人已确认协议并授权创建，`BioTrip-Maps` Key 已提交成功，平台为 **Web服务**。原候选名称 `BioTrip-Mobility` 超出 15 字符限制，提交时缩短。不要选择 Web 端 JS API，也不需要加载浏览器地图 SDK。

Key 只放进百炼高德 MCP 的私密配置，不进入 Git、前端、请求体、截图或诊断日志。高德控制台会显示适用范围和许可说明，创建者需自行核对；本次没有充值、购买套餐或开通收费服务。

官方接入说明：[高德 MCP 快速接入](https://developer.amap.com/api/mcp-server/gettingstarted)。其 Streamable HTTP 地址为 `https://mcp.amap.com/mcp?key=<你的Web服务Key>`。包含 Key 的完整地址也是凭据，不能作为普通链接分享。

## 2. 百炼独立出行顾问

在当前百炼业务空间的 MCP 管理中开通高德服务，按该服务的私密配置输入 Key；如果使用自定义 MCP，按官方文档配置 Streamable HTTP。先检查 `tools/list` 返回的工具定义。

创建「BioTrip 出行顾问」Agent 和独立运行环境：

- 只挂高德 MCP；不挂内置工具、Skill、FlyAI Vault、WHOOP 凭据或档案记忆。
- 仅允许 `maps_text_search`、`maps_search_detail`、`maps_direction_walking`、`maps_direction_driving`、`maps_direction_transit_integrated` 这五个只读工具。禁用地图创建、打车唤起、IP 定位等其他工具。
- 路线阶段不自动批准交互式工具审批；出现审批请求会降级。只读工具权限应由配置者在百炼中明确设置。
- 保存 Agent ID、环境 ID，以及实际 Session 快照中唯一 `mcp_servers` 条目的 ID。代码要求 skills 为空、唯一 MCP 与配置一致。旧版快照要求 tools 为空；当前官方 type/name + toolkit 快照要求内置工具默认关闭且逐项关闭、MCP 默认关闭且仅五个允许的工具启用。未知结构、额外工具、默认全开或交互审批会拒绝提交行程。

加入本地 `.dev.vars`（生产使用相同的 Worker 配置名）：

```dotenv
BAILIAN_MOBILITY_AGENT_ID=agent_01M4612XCPRXEA0CMCRCVQS1XZ
BAILIAN_MOBILITY_ENVIRONMENT_ID=env_ZWIzNGIxNGViN2Y4NDViNG
BAILIAN_MOBILITY_MCP_SERVER_ID=amap-maps
```

保留已有的 `BAILIAN_API_KEY` / 业务空间 / 托管智能体配置；此接入只在 Managed Agent provider 中启用，标准模型 API provider 继续明确降级。高德 Key 存在百炼的 MCP 配置中，BioTrip 不需要新增高德 Key 环境变量。修改本地环境后重启开发服务；生产配置变更后重新部署。

百炼官方参考：[MCP 管理与调试 CLI](https://docs.agent.bailian.aliyun.com/zh/mcp/cli)、[托管 Session 事件流](https://docs.agent.bailian.aliyun.com/zh/api/managed-agents/session/stream-events)。

## 3. 验收与数据边界

用独立测试旅程安排同一天相邻的「西湖」→「灵隐寺」等明确地点，疲劳较高时生成调整建议。阶段最多处理两段路线、十六次工具调用，总预算三十五秒；不自动重试。固定目标、跨日路段、泛称「酒店／午餐／展馆」或歧义地点不查询，不获取用户当前 GPS。

这里只发送城市与公开地点名，不发送日期、自评、WHOOP 或档案。坐标在内存中通过唯一同名 POI 绑定；搜索不含坐标时再以该 POI 的真实 ID 查详情。路线事实仅从配对的 `mcp_call` / `mcp_call_output` 提取，按工具结果的秒与米换算，不解析模型路线总结。

高德官方 NPM MCP `0.0.8` 的文本搜索省略 `location`，需要详情查询；驾车返回可能省略出租车费用。代码支持这些缺省，缺车费就不显示数字。实际远程服务的工具返回如与当前适配不一致，会降级；需要取得脱敏结构样本后调整解析器，不能猜字段。

成功时建议显示「高德估算」及真实工具返回的时长／距离／可选车费。调整编排失败也可保留确定性地图建议。应用仍需显式选择，版本检查和固定预约保护保持生效；若另一条建议删掉或替换路线起点，该地图建议不能同时采纳。

## 当前进度

已完成：配置项、独立会话、MCP 快照检查、原始事件配对、POI 搜索与详情关联、路线单位换算、并行流水线、建议绑定和卡片依据。

2026-10-05：经账号持有人明确授权，`BioTrip-Maps` Web 服务 Key 已保存到百炼官方 `amap-maps` 服务并开通。独立「BioTrip 出行顾问」Agent 和「BioTrip Mobility」环境创建成功；无内置工具、Skill、Vault 或预装包，仅启用上述五个高德工具。非秘密配置已写入 `wrangler.jsonc` 与本地 `.dev.vars`，已于 2026-10-05 部署。

百炼控制台测试会话 `sesn_01M4617K9R4FYZFN6K4Y70W982`：杭州公开地点「西湖」→「灵隐寺」，2 次关键词搜索、2 次 POI 详情、3 次路线查询，约 16 秒结束。真实驾车结果 5496 米 / 1383 秒，步行与公交均换算为 67 分钟，未返回出租车费。14 个配对调用/输出事件的工具 payload 已以控制台 content.completed 转为测试完成标记后送入现有解析器，得到驾车 24 分钟 / 5.5 公里；这验证工具 payload，不代表已验证应用使用的原始 SSE 包装或 Session 创建响应。

应用端实测（2026-10-05）：本地标准百炼 Key 鉴权通过。实际 Session 快照 skills 为空、MCP 默认关闭、仅五个允许工具启用；校验通过后才提交公开地点。真实 `PlanningProvider.mobility()` 经原始 SSE、事件配对和严格解析得到西湖→灵隐寺步行 67 分钟、驾车 21 分钟 / 5.5 公里、公交 66 分钟，用时约 19 秒。测试 Session 清理成功；无车费字段，因此不展示车费。

独立本地旅程 `aabbccdd-6666-4666-8666-aabbccdd6666` 的完整调整任务已通过身体解读、舒缓货架、当地口碑、出行顾问和建议编排；出行阶段约 14.5 秒，页面显示最新驾车 29 分钟 / 5.5 公里及「高德估算」。结果随路况与查询时间变化。验收发现地图与编排建议编号碰撞，已为确定性地图建议增加独立编号，并增加采纳解析回归测试。

第二轮真实任务出行阶段约 14.2 秒，最新驾车 28 分钟 / 5.5 公里。已在页面逐条选择并应用高德建议：只选择一条，旅程从第 1 版保存为第 2 版，灵隐寺的 `move` 持久化为 `mode: taxi, minutes: 28, km: 5.5, basis: amap`，18:00 固定演出保持不变；版本历史可查看原安排。

生产部署（2026-10-05）：版本 `c0d6d885-ca1f-40cb-8084-a3930ef86553` 已发布到 https://biotrip.eazylee.si，保留现有 Worker secrets，独立高德 Agent 配置和 Workflow 绑定已发布。远程迁移 `0008_adjustments.sql` 成功，无待执行迁移。线上首页、许可页与四项样式资源 200，匿名任务及状态接口 401，旧诊断接口 404；浏览器登录页加载正常。线上未重新运行真实路线会诊。

自动化验收：351 项测试通过；TypeScript、定向 ESLint、vinext 构建及 diff 空白检查通过。测试覆盖 MCP 事件配对、搜索/详情关联、错误输出与伪造数字拒绝、独立无 Vault 会话、配置快照检查、编排失败兜底、起点变更冲突及地图/编排建议身份隔离。
