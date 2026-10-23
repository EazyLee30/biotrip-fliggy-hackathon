/* eslint-disable @next/next/no-img-element -- Pre-optimized static images are served by Cloudflare. */
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight, AudioLines, Check, CircleCheck, CodeXml, Leaf, MapPin, MoveUpRight, Play, ShieldCheck, Sparkles } from "lucide-react";
import { LegacyEntry } from "./legacy-entry";
import { ProductFilm } from "./product-film";
import styles from "./landing.module.css";

const repo = "https://github.com/EazyLee30/biotrip-fliggy-hackathon";

function Phone({ src, alt }: { src: string; alt: string }) {
  return <div className={styles.phone}><div className={styles.phoneTop}><span>9:41</span><span>••• ▰</span></div><img src={src} alt={alt} width={738} height={1600} loading="lazy" /></div>;
}

export function LandingPage() {
  return <div className={styles.site}>
    <LegacyEntry />
    <a className={styles.skip} href="#main">跳到主要内容</a>
    <header className={styles.header}>
      <Link className={styles.brand} href="/" aria-label="BioTrip 首页"><Leaf size={26} strokeWidth={1.4} /><span>BioTrip<span className={styles.brandDot}>.</span></span></Link>
      <nav aria-label="主导航"><a className={styles.navLink} href="#story">产品理念</a><a className={styles.navLink} href="#film">观看影片</a><a className={styles.navCta} href="/app">开始体验 <ArrowUpRight size={16} /></a></nav>
    </header>
    <main id="main">
      <section className={styles.hero} aria-labelledby="hero-title">
        <img className={styles.heroImage} src="/landing/lakeside.webp" alt="湖畔夕阳下，旅行者放慢脚步，坐下来感受风景。AI 创作场景。" width={1672} height={941} fetchPriority="high" />
        <div className={styles.heroShade} />
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}><span /> TRAVEL AT YOUR OWN RHYTHM</p>
          <h1 id="hero-title">让旅途，<br />照顾好<span>今天的你。</span></h1>
          <p className={styles.heroDescription}>世界值得慢慢看。<br />听见身体的声音，让行程跟随你的节奏。</p>
          <div className={styles.heroActions}><a className={styles.lightButton} href="/app">开启我的旅程 <ArrowUpRight size={19} /></a><a className={styles.watchLink} href="#film"><Play size={15} /> 看一段旅途的故事 <span>02:37</span></a></div>
        </div>
        <div className={styles.heroBottom}><span>BODY IN MIND. WORLD IN SIGHT.</span><a href="#film">向下，遇见 BioTrip <ArrowDown size={15} /></a><span className={styles.sceneLabel}>杭州 · 湖畔想象 / AI 场景</span></div>
      </section>

      <section id="film" className={styles.filmSection} aria-labelledby="film-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>THE BIOTRIP FILM / 01</p><h2 id="film-title">把行程交给灵感，<br className={styles.mobileBreak} /><em>把节奏留给自己。</em></h2></div><p>用 2 分 37 秒，走进一次<br />从身体感受出发的旅行。</p></div>
        <ProductFilm />
      </section>

      <section id="story" className={`${styles.section} ${styles.story}`} aria-labelledby="story-title">
        <div className={styles.storyCopy}><p className={styles.eyebrow}>A LITTLE LESS RUSH / 02</p><h2 id="story-title">攻略里有目的地。<br /><em>旅程里，应该有你。</em></h2><p className={styles.bodyCopy}>可能昨晚没睡好，可能走到下午有些累，<br className={styles.desktopBreak} />也可能只想在一间喜欢的茶馆多坐一会儿。</p><p className={styles.bodyCopy}>BioTrip 把身体感受、旅行偏好与 AI 规划连在一起。<br className={styles.desktopBreak} />从出发前的期待，到旅途中的每一次调整，<br className={styles.desktopBreak} />让行程更适合此刻的你。</p><a className={styles.textLink} href="/app">找到我的旅行节奏 <ArrowUpRight size={18} /></a><div className={styles.storyFoot}><span>01 — 感受</span><span>02 — 调整</span><span>03 — 再出发</span></div></div>
        <div className={styles.phoneStage}><div className={styles.stageCircle} /><span className={styles.stageWord}>breathe.</span><Phone src="/landing/today.webp" alt="BioTrip 实际界面：杭州旅途中，在西湖慢走前记录此刻的身体感受" /><div className={styles.floatNote}><Leaf size={20} /><div><strong>今天，慢一点也很好。</strong><span>你的感受，是行程的一部分。</span></div></div><span className={styles.screenLabel}>BioTrip · 实际产品界面</span></div>
      </section>

      <section className={styles.wearables} aria-labelledby="wearables-title">
        <div className={styles.wearableVisual}><div className={styles.wearableOrbit} /><img className={styles.band} src="/landing/whoop.webp" alt="WHOOP 黑色织物手环" width={800} height={800} loading="lazy" /><div className={styles.dashboardShot}><img src="/landing/whoop-dashboard.webp" alt="真实授权 WHOOP Dashboard：恢复指数 62%，睡眠 5.8 小时，运动负荷 4.5，步数 4342。拍摄时的历史记录。" width={378} height={819} loading="lazy" /></div><div className={styles.deviceTag}><span /> WHOOP · 已支持</div></div>
        <div className={styles.wearableCopy}><p className={styles.eyebrow}>LISTEN TO YOUR BODY / 03</p><h2 id="wearables-title">身体有信号，<br /><em>旅途有回应。</em></h2><p className={styles.bodyCopy}>连接 WHOOP，在身体 Dashboard 查看恢复、睡眠、运动负荷与步数。把这些记录与此刻的自我感受一起，变成更合适的旅行节奏。</p><div className={styles.metricLabels}><span>恢复</span><span>睡眠</span><span>负荷</span><span>步数</span></div><p className={styles.deviceNote}>每次规划，由你决定是否使用身体记录。<br />没有设备，也可以从自己的感受开始。</p><div className={styles.future}><AudioLines size={22} /><div><strong>从 WHOOP 出发，连接更多可能。</strong><p>后续将支持更多可穿戴设备的数据源。</p><span>COMING NEXT · 持续拓展中</span></div></div><small className={styles.dataCaption}>画面为本人授权的历史记录，非实时读数。</small></div>
      </section>

      <section id="rhythm" className={`${styles.section} ${styles.loop}`} aria-labelledby="loop-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>A JOURNEY THAT LEARNS / 04</p><h2 id="loop-title">每一次“舒服一些”，<br /><em>都让下一步更懂你。</em></h2></div><p>感受不是一次性的输入，<br />而是旅程持续变好的起点。</p></div>
        <ol className={styles.steps}>
          <li><span className={styles.stepNumber}>01</span><h3>听见当下</h3><p>记录疲劳与心情，<br />说说此刻想怎样旅行。</p><ArrowRight size={20} /></li>
          <li><span className={styles.stepNumber}>02</span><h3>温和调整</h3><p>少走一点、多休息一会儿。<br />看清变化，再决定采用。</p><ArrowRight size={20} /></li>
          <li><span className={styles.stepNumber}>03</span><h3>再问一次感受</h3><p>轻松了一些，还是仍然累？<br />把真实体验留在旅程里。</p><ArrowRight size={20} /></li>
          <li><span className={styles.stepNumber}>04</span><h3>让建议更贴近你</h3><p>近期反馈参与后续建议，<br />长期偏好由你选择记住。</p><CircleCheck size={20} /></li>
        </ol>
        <div className={styles.loopReturn}><span>记录感受</span><i /><span>调整旅程</span><i /><span>体验反馈</span><i /><span>更适合的下一步</span><span aria-hidden="true">↺</span></div>
        <div className={styles.principle}><ShieldCheck size={28} strokeWidth={1.4} /><div><h3>你的旅程，始终由你决定。</h3><p>保护固定预约与已完成安排；每次变更先预览、再确认，并保留版本记录。</p></div><Check size={22} /></div>
      </section>

      <section className={styles.companion} aria-labelledby="companion-title">
        <div className={styles.companionIntro}><p className={styles.eyebrow}>ALONG THE WAY / 05</p><h2 id="companion-title">从一个念头，<br />到一路相伴。</h2><p>该做计划的时候，认真一点。<br />该看风景的时候，轻松一点。</p><Sparkles size={31} strokeWidth={1} /></div>
        <div className={styles.featureRows}>
          <article><span>01</span><div><h3>一份属于你的行程</h3><p>从目的地、日期与偏好出发，逐日安排，让期待落到每一步。</p></div><MapPin size={22} strokeWidth={1.3} /></article>
          <article><span>02</span><div><h3>有出处的发现</h3><p>结合飞猪旅行服务与高德路线信息，发现目的地，也看清信息来源。</p></div><MoveUpRight size={22} strokeWidth={1.3} /></article>
          <article><span>03</span><div><h3>一个随时聊聊的伙伴</h3><p>查询安排、整理旅行清单、提出调整建议。重要变更，交给你确认。</p></div><AudioLines size={22} strokeWidth={1.3} /></article>
          <article><span>04</span><div><h3>把喜欢的片刻留下</h3><p>收藏想去的地方，分享一份旅行手记，让这段旅程有迹可循。</p></div><Leaf size={22} strokeWidth={1.3} /></article>
        </div>
      </section>

      <section className={styles.closing} aria-labelledby="closing-title"><p className={styles.eyebrow}>YOUR NEXT CHAPTER</p><h2 id="closing-title">世界很大，<em>按你的节奏走。</em></h2><p>下一段旅程，从照顾好今天的自己开始。</p><a className={styles.darkButton} href="/app">与 BioTrip 一起出发 <ArrowUpRight size={20} /></a></section>
    </main>
    <footer className={styles.footer}><div><Link className={styles.brand} href="/"><Leaf size={24} strokeWidth={1.4} /><span>BioTrip.</span></Link><p>让旅途，照顾好今天的你。</p></div><div className={styles.footerLinks}><a href="#film">产品影片</a><a href={repo} target="_blank" rel="noreferrer"><CodeXml size={14} /> 项目源码 <ArrowUpRight size={12} /></a><a href="/privacy">隐私说明</a></div><div className={styles.byline}><span>独立构建 · Eazy Lee</span><span>© 2026 BioTrip</span></div></footer>
  </div>;
}
