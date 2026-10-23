"use client";
import { useEffect, useState } from "react";
import { ToggleSwitch } from "../toggle-switch";
import css from "./agent.module.css";
type Settings = { useMemory: boolean; useWhoop: boolean };
export function AgentSettings({ onOpenMemory }: { onOpenMemory?: () => void }) {
  const [settings, setSettings] = useState<Settings>({
      useMemory: true,
      useWhoop: true,
    }),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let revision = 0;
    async function load() {
      const current = ++revision;
      try {
        const response = await fetch("/api/agent/settings", { cache: "no-store", signal: controller.signal });
        const value = await response.json() as Settings & { error?: string };
        if (!response.ok) throw new Error(value.error || "设置读取失败");
        if (controller.signal.aborted || current !== revision) return;
        setSettings({ useMemory: value.useMemory, useWhoop: value.useWhoop }); setLoaded(true); setError("");
      } catch (e) { if (!controller.signal.aborted && current === revision) setError(e instanceof Error ? e.message : "设置读取失败"); }
    }
    void load();
    const changed = () => { void load(); };
    window.addEventListener("biotrip:memory-changed", changed);
    return () => { controller.abort(); window.removeEventListener("biotrip:memory-changed", changed); };
  }, []);

  async function update(key: keyof Settings, value: boolean) {
    const previous = settings,
      next = { ...settings, [key]: value };
    setSettings(next);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/agent/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const saved = (await response.json()) as Settings & { error?: string };
      if (!response.ok) throw new Error(saved.error || "设置保存失败");
      setSettings({ useMemory: saved.useMemory, useWhoop: saved.useWhoop });
      window.dispatchEvent(new Event("biotrip:memory-changed"));
    } catch (e) {
      setSettings(previous);
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={css.memory} aria-label="助手设置">
      <div className={css.memoryIntro}>
        <span className={css.eyebrow}>PREFERENCES</span>
        <h3>按你的习惯提供帮助</h3>
        <p>设置随账号保存，用于之后的对话和助手规划。</p>
      </div>
      <label className={css.switchRow}>
        <span>
          <strong>规划时使用 WHOOP</strong>
          <small>连接设备后，临近出发或旅途中参考近期记录</small>
        </span>
        <ToggleSwitch
          label="规划时使用 WHOOP"
          checked={settings.useWhoop}
          disabled={!loaded || busy}
          onChange={(checked) => void update("useWhoop", checked)}
        />
      </label>
      {onOpenMemory ? <button type="button" onClick={onOpenMemory}>记忆使用与自动保存 · 进入记忆管理 ›</button> : null}
      {error && (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
