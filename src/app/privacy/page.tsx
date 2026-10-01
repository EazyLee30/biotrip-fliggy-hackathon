import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "隐私说明 · BioTrip",
  description: "BioTrip 对 WHOOP、旅行偏好和百炼处理方式的说明。",
};

const sections = [
  {
    title: "接入哪些 WHOOP 数据",
    body: "经你在 WHOOP 授权页同意后，BioTrip 可读取基础资料、恢复、周期、睡眠、训练和身体测量。账户页显示设备真实返回的近期摘要，缺少的指标保持为空。仅当你逐次允许使用设备数据，且旅程已开始或出发前 36 小时内，规划才读取近期记录；更早的远期预案不读取当前身体指标。WHOOP 姓名和邮箱只用于显示连接账号，不发送给任何 AI 服务。",
  },
  {
    title: "数据会发给谁：三个互相隔离的智能体",
    body: "只有你在每次生成规划前点击同意，才会发送本次行程与旅行偏好。规划由三个阿里云百炼托管智能体分工完成，它们的运行环境与可用工具彼此隔离：① 健康解读智能体没有配置任何工具、Skill 或凭据，只接收你授权范围内的近 7 天 WHOOP 记录与本次自评，输出仅为「步行节奏／休息频率／环境筛选条件」等抽象条件，不返回原始指标、姓名或邮箱；② 当地资料检索智能体只接收城市、日期与所选服务／饮食偏好，不接收任何身体数据；③ 行程编排智能体接收行程、抽象节奏条件和你在确认页看到的档案记忆，不接收 WHOOP 原始记录与自评数字。飞猪（FlyAI）搜索只接收旅行筛选条件，由百炼密钥库注入、仅在行程编排智能体的单次会话中替换为真实凭据；WHOOP 密钥以加密形式保存在 BioTrip 服务器，不进入任何智能体。未来旅程不会用当前身体状态预测未来。系统按固定规则对阶段数据做隔离，而非依赖提示词约定；相关断言包含在随源码提供的测试中。请勿在固定安排、饮食偏好或档案记忆中填写身份证件、联系方式或敏感健康信息。",
  },
  {
    title: "保存与保留",
    body: "Cloudflare D1 保存登录邮箱、显示名、旅行偏好、旅程草稿与生成方案、你主动提交的体感反馈和记忆，以及公开分享内容。设置密码时仅保存随机盐与密码派生哈希，不保存明文密码；首次设置和重置均需验证邮箱。验证码和登录会话仅保存哈希，验证码 10 分钟到期，会话最长 30 天；重置密码使其他设备会话失效。邮箱与网络地址经 HMAC 转成限速标识后保存，限速表不保留原始地址。WHOOP OAuth token 以 AES-256-GCM 加密后保存在服务器数据库中，按账户隔离，因此一次授权在换设备或清理浏览器后仍然有效，直到你在账户页主动断开；原始身体指标本身不写入数据库。公开资料检索的请求设置 store=false；百炼可能保留智能体会话的事件历史，BioTrip 在读取结构化结果后立即请求删除该会话，但这不等同于承诺清除供应商全部后台副本，供应商的保留政策以其条款为准。分享链接 90 天后失效，账户页可提前撤回。",
  },
  {
    title: "撤回授权",
    body: "你可以在 BioTrip 账户页断开 WHOOP，或在 WHOOP 的连接应用设置中撤销访问。断开后本账户的所有设备都不再读取你的身体记录，并会同时向 WHOOP 请求撤销授权。你也可以在每次规划时不勾选设备数据。已发出的请求不受之后撤权影响。你可以在个人档案清空旅行记忆、移除单条反馈记忆、逐条忘记自动学习的偏好，或撤回公开分享链接；旅程可以单独删除。登录邮箱与账户记录的删除目前需联系运营者处理。",
  },
  {
    title: "健康与旅行边界",
    body: "BioTrip 用身体数据调整旅行节奏，不提供诊断、治疗、用药、补剂或营养处方。身体数据只用于本次行程的节奏安排，不用于推断人格、情绪或疾病；颜色只是你个人表达的偏好。当地医疗资料只提供公开官方来源；温泉、按摩与食物介绍不代表疗效或健康承诺。航班、住宿、保险和其他旅行服务由相应服务方提供；BioTrip 不替你预订、付款或修改外部订单。",
  },
  {
    title: "第三方服务说明",
    body: "邮箱验证、验证码登录与密码重置通过 Resend 事务邮件发送；密码不发送给邮件供应商或 AI。旅行规划使用阿里云百炼托管智能体、公开资料搜索及飞猪（FlyAI）搜索；Token Plan 套餐 Key 不用于应用后端。服务配置、额度或授权不可用时，页面会给出明确错误，不展示伪造行程、商品或身体指标；某一步检索未核验时，界面会明确标注「本次未核验」，并只依据已核验来源编排。具体服务商的数据处理、保留与跨境规则以其条款和账号设置为准。BioTrip 不出售 WHOOP 数据。",
  },
];

export default function PrivacyPage() {
  return (
    <main className="privacy-page">
      <header className="privacy-topbar">
        <Link className="privacy-brand" href="/">BioTrip <span>让旅程跟随你的节奏</span></Link>
        <Link className="privacy-back" href="/">返回旅程规划 <span aria-hidden="true">↗</span></Link>
      </header>
      <article className="privacy-document">
        <div className="privacy-overline">BIOTRIP · 数据与隐私</div>
        <h1>你的身体数据，<br /><em>由你决定何时启用。</em></h1>
        <p className="privacy-intro">这份说明描述 BioTrip 当前版本的 WHOOP 数据访问、百炼处理和设备端存储方式。请在连接设备或生成行程前阅读。</p>
        <div className="privacy-updated">更新日期：2026 年 10 月 1 日</div>
        <div className="privacy-sections">
          {sections.map((section, index) => (
            <section className="privacy-section" key={section.title}>
              <span className="privacy-index">{String(index + 1).padStart(2, "0")}</span>
              <div><h2>{section.title}</h2><p>{section.body}</p></div>
            </section>
          ))}
        </div>
        <aside className="privacy-note"><span aria-hidden="true">⌑</span><p>WHOOP 数据只用于你主动发起并逐次确认的规划请求。断开连接后，新请求不会再读取 WHOOP 数据。</p></aside>
      </article>
      <footer className="privacy-footer"><span>BioTrip · 旅程与你一起变化</span><Link href="/">返回首页 ↑</Link></footer>
    </main>
  );
}
