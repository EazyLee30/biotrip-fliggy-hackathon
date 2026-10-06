"use client";
import { shareThroughSystem } from "@/lib/browser-share";
import { useRef, useState } from "react";
export function ShareActions({ title }: { title: string }) {
  const sharing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function share() {
    if (sharing.current) return;
    sharing.current = true; setBusy(true); setMessage("");
    const url = window.location.href;
    try {
      const result = await shareThroughSystem(navigator, { title, url });
      if (result === "shared" || result === "cancelled") return;
      try { await navigator.clipboard.writeText(url); setMessage("链接已复制"); }
      catch { setMessage("请从浏览器地址栏复制链接。"); }
    } finally { sharing.current = false; setBusy(false); }
  }
  return <><button className="zen-share-action" type="button" disabled={busy} onClick={() => void share()}>{busy ? "分享面板打开中…" : "分享这段旅程 ↗"}</button>{message ? <p role="status">{message}</p> : null}</>;
}
