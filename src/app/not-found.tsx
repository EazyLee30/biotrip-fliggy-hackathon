import "./status-page.css";

export default function NotFoundPage() {
  return (
    <main className="status-page">
      <a className="status-brand" href="/">BioTrip<span>让旅程跟随你的节奏</span></a>
      <section className="status-card">
        <span className="status-symbol" aria-hidden="true">⌁</span>
        <h1>这条路还没有抵达</h1>
        <p>页面不存在，或分享链接已经失效。回到首页，继续你的下一段旅程。</p>
        <a className="status-primary" href="/">返回我的旅程</a>
      </section>
    </main>
  );
}
