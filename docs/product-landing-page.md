# BioTrip 产品首页

产品域名：<https://biotrip.eazylee.si>。首页讲述产品与展示完整宣传片，应用位于 `/app`。个人独立参赛，团队名称与作者为 Eazy Lee。

## 入口与兼容

- `/`：产品首页；`/#film`：影片；`/#story`：产品理念；`/#rhythm`：反馈闭环。
- `/app`：现有旅程应用；登录默认回到 `/app`。
- 旧 `/?journey=…`、`/?view=…`、`/?whoop=…` 保留所有查询参数并转到 `/app`。
- 旧 `/#today`、`/#body` 等应用片段经客户端转到 `/app#…`，首页自己的锚点不受影响。
- WHOOP OAuth 回跳和 `/profile` 转入新应用路径。OAuth 注册的回调 API URL 没有改变。
- PWA manifest 保留原安装 ID 与 scope，start_url 改为 `/app`；已安装旧版从首页启动时也转入应用。

## 内容与媒体

首页围绕听见身体、温和调整、再次反馈和后续建议展开，明确长期偏好由用户选择记住。WHOOP 是当前已支持的数据源；更多可穿戴设备标注为后续计划。页面没有“为黑客松而作”的宣传语。

- 网页影片：`public/film/biotrip-v3.mp4`，157.013 秒，1920×1080 / 30 fps，H.264 + AAC，13,948,597 字节，faststart，用户主动播放，支持原生控制和四个章节入口。
- 原始高质量交付影片保留于 `output/biotrip-film/delivery/`，没有被覆盖。
- 线上播放器通过 `/api/film/v3` 返回精确的 HTTP 206 字节范围，避免静态资产服务忽略 Range 后整片传输。接口只读固定公开影片，用流式截取和 FixedLengthStream 控制内存，并处理 HEAD、尾段、无效范围和客户端取消。
- 中文可选字幕：`public/film/biotrip-v3.vtt`；画面本身已有字幕。
- `public/landing/`：压缩后的电影封面、湖畔视觉、手机截图、WHOOP 手环透明素材与实际 Dashboard。
- WHOOP 数值为账户本人授权展示的拍摄时历史记录，页面明确说明非实时读数。湖畔背景明确标注 AI 场景。
- 源码入口连接现有仓库 <https://github.com/EazyLee30/biotrip-fliggy-hackathon>。仓库可见性不由首页部署改变。

## 验证与发布

486 项测试通过，其中 8 项覆盖影片范围播放、边缘服务元数据与取消处理。使用 `pnpm exec tsc --noEmit`、相关 ESLint、`pnpm test`、`pnpm run build:vinext` 检查。`tsconfig.json` 排除独立视频工程和输出目录 `output`，避免将其 Remotion 源码当作主应用编译输入。

通过现有 Cloudflare Workers 部署流程发布，保持 D1、Workflow、定时任务、域名及服务器密钥绑定。没有新增数据库迁移。检查与截图在 `output/landing-check-20261023/`，报名材料在 `output/submission-check-20261023/`。
