# BioTrip 邮箱登录与域名邮件

BioTrip 的验证码邮件从 Cloudflare Worker 通过 Resend HTTPS API 发送。Cloudflare Email Routing 可以单独转发发往 BioTrip 自定义地址的来信；收件转发不是验证码邮件的发送通道。

## 首次配置

1. 在 Resend 添加并验证发信子域 `notify.biotrip.ccwu.cc`。Resend 推荐使用子域区分事务邮件并隔离发件声誉。
2. 在 Cloudflare DNS 中按 Resend 控制台逐条添加其为该子域给出的验证记录。不要删改其他现有 DNS 记录；DNS 名称、内容和代理状态以 Resend 当前页面说明为准。
3. 在 Resend 创建仅用于邮件发送的 API Key。
4. 将 API Key 作为 Cloudflare Worker Secret 写入，不要写进源码、`wrangler.jsonc` 或聊天：

   ```sh
   pnpm exec wrangler secret put RESEND_API_KEY
   ```

5. 确认 Worker 的 `RESEND_FROM_EMAIL` 为 `BioTrip <login@notify.biotrip.ccwu.cc>`，部署后发送一次登录验证码并检查收件箱及 Resend 投递日志。

在域名验证完成且 `RESEND_API_KEY` 已配置前，登录邮件发送会失败；应用不会显示假验证码，也不会退回模拟登录。

## 可选：Cloudflare Email Routing 收件

如果需要 `support@biotrip.ccwu.cc` 等收件地址，在 Cloudflare Email Routing 启用域名、添加并验证实际收件邮箱，再创建自定义地址到该邮箱的转发规则。Cloudflare 会配置收件所需的 DNS 记录。目标收件地址由账户持有人选择；BioTrip 的验证码登录无需设置或读取这个地址。

## 运行时配置

- `RESEND_API_KEY`：Cloudflare Worker Secret。
- `RESEND_FROM_EMAIL`：普通 Worker 变量；默认值为 `BioTrip <login@notify.biotrip.ccwu.cc>`。

Resend API 调用只发送邮箱地址和一次性验证码，不把 WHOOP 或旅行数据放进邮件。供应商会按其服务条款处理投递数据。

## 用户登录流程

- `/login` 默认使用邮箱和密码，登录不再要求每次收取邮件。
- “注册 / 首次设置密码”先填写邮箱和 12–128 个字符的密码，再使用一封验证邮件中的验证码完成邮箱验证和密码设置，随即登录。
- 已有验证码账户使用同一个邮箱设置密码，账户 ID、个人档案、WHOOP 连接及分享记录保留。已登录用户也可进入 `/profile` 的“登录与安全”设置或修改密码。
- “忘记密码”使用邮箱验证码验证身份并设置新密码；设置或重置密码后，旧会话全部失效，当前设备获得新的 30 天登录会话。
- “验证码登录”作为可选方式保留。登录码与密码设置码有独立用途，不能互相替代，均为 10 分钟有效、最多尝试 5 次、发送间隔至少 60 秒。

`/api/auth/password/login` 验证邮箱和密码；`/api/auth/password` 通过密码用途的邮箱验证码设置或重置密码。验证码发送和验证、密码登录都按邮箱与请求网络地址限速。请求只接受本站 Origin，登录 Cookie 为 Secure、HttpOnly、SameSite=Lax。

## 数据迁移和密码运维

部署密码登录版本前应用 D1 migration `migrations/0002_password_auth.sql`。该迁移为验证码添加用途字段，并创建密码凭据及限速表，不修改或删除既有账户与档案。先应用迁移再部署新代码，旧版本可继续使用新增字段的默认登录用途。

密码以随机 128 位盐、PBKDF2-HMAC-SHA256 派生哈希和迭代次数存入 D1；当前迭代次数为 100,000。派生前使用 Worker Secret `AUTH_SECRET` 做 HMAC pepper，数据库不保存 pepper 或明文密码。限速表只保存 HMAC 后的标识、计数和到期时间，邮箱和网络地址不以明文放入该表。密码不会发送到 Resend、WHOOP 或 AI 服务。

`AUTH_SECRET` 需要长期稳定保管，不能在普通部署中重新随机生成。轮换该 secret 会使现有密码派生结果无法验证，也会使尚未使用的邮件验证码失效；应安排用户通过“忘记密码”重新验证邮箱并设置密码。若因泄漏而轮换，还应撤销既有登录会话；仅替换 secret 不会自动撤销 D1 中已创建的会话。不要把旧值、新值或密码记录输出到日志、源码或聊天。
