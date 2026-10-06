"use client";
import { useState } from "react";
import type { Journey } from "@/lib/journey-types";
import css from "./journey-visual-button.module.css";

export function JourneyVisualButton({ journey, onSaved }: { journey: Journey; onSaved: (journey: Journey) => void }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  if (!journey.plan || !journey.planCurrent) return null;
  return <div className={css.container}>
    <button className={css.action} type="button" disabled={loading} onClick={async () => {
      setLoading(true); setMessage("");
      try {
        const response = await fetch(`/api/journeys/${journey.id}/visuals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: journey.version }) });
        const result = await response.json() as { error?: string; updated: boolean; journey: Journey };
        if (!response.ok) throw new Error(result.error || "暂时无法补图。");
        if (result.updated) onSaved(result.journey);
        setMessage(result.updated ? "目的地实景已更新。" : "当前没有新的可用实景。");
      } catch (error) { setMessage(error instanceof Error ? error.message : "暂时无法补图。"); }
      finally { setLoading(false); }
    }}>{loading ? "正在查找实景…" : journey.plan.visuals?.cover.length ? "更新目的地实景" : "为旅程补充实景"}</button>
    <small className={css.note} role="status">{message || "仅查询目的地城市，不发送身体数据。"}</small>
  </div>;
}
