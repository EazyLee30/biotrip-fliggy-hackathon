"use client";

import { useEffect, useState } from "react";
import "./share.css";

type Share = { destination: string; headline: string; summary: string; places: Array<{ name: string; category: string; url: string }> };

export default function SharedTripPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState("");
  const [share, setShare] = useState<Share | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => { void params.then(({ id: shareId }) => setId(shareId)); }, [params]);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    void fetch(`/api/share/${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const payload = await response.json() as { share?: Share; error?: string };
      if (!response.ok || !payload.share) throw new Error(payload.error || "分享页面不存在或已过期。");
      setShare(payload.share);
    }).catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "分享页面暂时无法打开。"); });
    return () => controller.abort();
  }, [id]);

  async function sharePage() {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: share?.headline || "BioTrip 旅程", text: share?.summary || "一段为今天的自己调整过的旅程", url }).catch(() => undefined);
      return;
    }
    try { await navigator.clipboard.writeText(url); setCopied(true); }
    catch { setError("暂时无法复制，请从浏览器地址栏复制这个链接。"); }
  }

  return <main className="zen-share-page"><header className="zen-share-header"><a className="zen-share-brand" href="/">BioTrip <span>让旅程跟随你的节奏</span></a><a href="/login">规划我的旅程 ↗</a></header><article className="zen-share-card"><div className="zen-share-kicker">一段属于自己的旅程</div><div className="zen-share-destination">{share?.destination || (error ? "分享暂不可用" : "正在打开旅程…")}</div>{share && <><h1>{share.headline}</h1><p className="zen-share-summary">{share.summary}</p>{share.places.length > 0 && <section className="zen-share-places"><h2>真实来源 · 供你探索</h2>{share.places.map((place) => <a key={`${place.url}-${place.name}`} href={place.url} target="_blank" rel="noopener noreferrer"><span>{place.category}</span><strong>{place.name} ↗</strong></a>)}</section>}<div className="zen-share-safety">这里展示发布者确认分享的城市、旅程简介与来源。链接可公开访问，90 天后自动失效；预订请以服务方页面为准。</div><button className="zen-share-action" type="button" onClick={() => void sharePage()}>{copied ? "链接已复制 ✓" : "分享这段旅程 ↗"}</button></>}{error && <div className="zen-share-expired" role="status">{error}</div>}</article><footer className="zen-share-footer">BioTrip · 让旅程照顾好今天的你</footer></main>;
}
