"use client";
import { useEffect, useRef, useState } from "react";
import type { JourneyShareSnapshot } from "@/lib/journey-share";
import type { PosterPage } from "@/lib/share-poster";
import { shareThroughSystem } from "@/lib/browser-share";
import styles from "./share-poster-panel.module.css";

/* eslint-disable @next/next/no-img-element -- Local canvas Blob previews support native long-press saving and cannot use an image optimization URL. */

type Preview = PosterPage & { url: string };
export function SharePosterPanel({ snapshot, url }: { snapshot: JourneyShareSnapshot; url?: string }) {
  const [pages, setPages] = useState<Preview[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const resources = useRef<string[]>([]);
  const alive = useRef(true);
  const sharing = useRef(false);
  const [shareBusy, setShareBusy] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; for (const value of resources.current) URL.revokeObjectURL(value); }; }, []);
  async function prepare() {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const { createSharePosters } = await import("@/lib/share-poster");
      const results = await createSharePosters(snapshot, url || window.location.href);
      if (!alive.current) return;
      for (const value of resources.current) URL.revokeObjectURL(value);
      const previews = results.map((page) => ({ ...page, url: URL.createObjectURL(page.blob) }));
      resources.current = previews.map((page) => page.url); setPages(previews);
    } catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : "海报暂时无法准备，请重试。"); }
    finally { if (alive.current) setBusy(false); }
  }
  async function shareFiles() {
    if (!pages.length || sharing.current) return;
    sharing.current = true; setShareBusy(true); setMessage("");
    try {
      const files = pages.map((page) => new File([page.blob], page.filename, { type: "image/png" }));
      const result = await shareThroughSystem(navigator, { title: snapshot.headline, files });
      if (alive.current && (result === "failed" || result === "unsupported")) setMessage("系统分享图片暂不可用，请逐张保存图片，或长按图片使用系统菜单。");
    } catch { if (alive.current) setMessage("当前浏览器无法分享文件，请逐张保存图片。"); }
    finally { sharing.current = false; if (alive.current) setShareBusy(false); }
  }
  return <section className={styles.panel} aria-label="旅行札记海报"><button type="button" disabled={busy} onClick={() => void prepare()}>{busy ? "正在排版海报…" : pages.length ? "重新准备海报" : "制作旅行札记海报"}</button>{pages.length ? <><p>共 {pages.length} 张，内容按顺序完整排版。保存后的图片无法随链接撤回。</p><div className={styles.previews}>{pages.map((page, index) => <figure key={page.url}>{/* Blob previews support long-press saving without remote image requests. */}<img src={page.url} alt={`公开旅程海报第 ${index + 1} 张`} /><figcaption><a href={page.url} download={page.filename}>保存第 {index + 1} 张图片</a></figcaption></figure>)}</div><button type="button" disabled={shareBusy} onClick={() => void shareFiles()}>{shareBusy ? "分享面板打开中…" : "通过系统分享图片"}</button></> : null}{message ? <p role="status">{message}</p> : null}</section>;
}
