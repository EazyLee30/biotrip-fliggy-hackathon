import type { CSSProperties, ReactNode } from "react";

export type AccountIconName = "user" | "pin" | "sync" | "edit" | "leaf" | "pulse" | "moon" | "watch" | "plane" | "shield" | "sun" | "sliders" | "compass" | "lock" | "check";
const paths: Record<AccountIconName, ReactNode> = {
  user: <><circle cx="12" cy="8" r="3" /><path d="M5 21v-3a7 7 0 0 1 14 0v3z" /></>,
  pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0z" /><circle cx="12" cy="10" r="2" /></>,
  sync: <><path d="M20 8V3l-3 3a8 8 0 0 0-13 6M4 16v5l3-3a8 8 0 0 0 13-6M20 3h-5M4 21h5" /></>,
  edit: <><path d="m15 4 5 5M4 20l4-1L20 7a2 2 0 0 0-3-3L5 16zM4 4h6M4 8h3" /></>,
  leaf: <><path d="M20 3C10 3 4 7 4 13a6 6 0 0 0 6 6c6 0 10-6 10-16ZM4 21 15 10M10 16v-5" /></>,
  pulse: <path d="M2 12h5l3-8 4 16 3-8h5" />,
  moon: <path d="M20 15a9 9 0 0 1-11-11A9 9 0 1 0 20 15z" />,
  watch: <><rect x="6" y="6" width="12" height="12" rx="5" /><path d="M9 2h6l1 4M9 22h6l1-4M12 9v3l2 1" /></>,
  plane: <path d="m2 13 7-1-4-7 2-1 7 7 6-1a2 2 0 0 1 1 4l-7 1-5 5-2-1 2-5-5 1z" />,
  shield: <><path d="m12 2 8 3v6c0 5-8 10-8 10S4 16 4 11V5z" /><path d="m8 11 3 3 5-6" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></>,
  sliders: <><path d="M5 3v4M5 13v8M12 3v10M12 19v2M19 3v1M19 10v11M2 7h6M9 13h6M16 4h6" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m16 8-3 5-5 3 3-5z" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3" /></>,
  check: <path d="m5 12 4 4L19 6" />,
};
export default function AccountIcon({ name, size = 20, style }: { name: AccountIconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]}</svg>;
}
