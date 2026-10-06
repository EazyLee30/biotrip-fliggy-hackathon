import Link from "next/link";
import "./share.css";

export default function ShareNotFound() {
  return <main className="zen-share-page"><header className="zen-share-header"><Link className="zen-share-brand" href="/">BioTrip</Link></header><article className="zen-share-card"><div className="zen-share-body zen-share-expired"><h1>这份旅行手记暂不可用</h1><p>链接不存在、已撤回或已过期。可以向发布者索取新的链接。</p><Link href="/">返回 BioTrip ↗</Link></div></article></main>;
}
