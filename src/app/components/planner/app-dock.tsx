"use client";

import { Icon, type IconName } from "../zen-ui";
import type { AppView } from "./app-navigation";
import styles from "./app-dock.module.css";

const entries: Array<{ view: "today" | "itinerary" | "explore" | "profile"; label: string; icon: IconName }> = [
  { view: "today", label: "今天", icon: "sun" },
  { view: "itinerary", label: "行程", icon: "calendar" },
  { view: "explore", label: "发现", icon: "compass" },
  { view: "profile", label: "我的", icon: "person" },
];

export function AppDock({ view, disabled, onNavigate }: { view: AppView; disabled?: boolean; onNavigate: (next: typeof entries[number]["view"]) => void }) {
  return <nav className={styles.dock} aria-label="主导航">{entries.map((entry) => <button type="button" key={entry.view} disabled={disabled} aria-current={view === entry.view ? "page" : undefined} onClick={() => onNavigate(entry.view)}><Icon name={entry.icon} size={21} /><span>{entry.label}</span></button>)}</nav>;
}
