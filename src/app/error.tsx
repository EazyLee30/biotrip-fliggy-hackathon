"use client";

import Link from "next/link";
import "./status-page.css";

export default function ErrorPage({ retry, reset }: { retry?: () => void; reset: () => void }) {
  return (
    <main className="status-page">
      <Link className="status-brand" href="/">BioTrip<span>让旅程跟随你的节奏</span></Link>
      <section className="status-card" role="alert">
        <span className="status-symbol" aria-hidden="true">↻</span>
        <h1>这一步暂时没能完成</h1>
        <p>请重新加载页面。已保存到账号的旅程和偏好，可以在连接恢复后继续查看。</p>
        <button onClick={() => (retry ?? reset)()}>重新加载</button>
        <Link className="status-secondary" href="/">返回我的旅程</Link>
      </section>
    </main>
  );
}