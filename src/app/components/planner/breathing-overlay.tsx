import { useEffect, useRef, type ReactNode } from "react";
import styles from "../zen-dashboard.module.css";

/**
 * A focus activity that owns the whole screen.
 *
 * Breathing was a page you scrolled to, which meant arriving at the bottom of
 * it and scrolling back up to find the animation. As an overlay the session is
 * always centred, the page behind cannot scroll, and closing returns the
 * traveller exactly where they were — no wasted scrolling in either direction.
 */
export function BreathingOverlay({ open, children }: { open: boolean; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Freeze the page behind the session so a wheel or swipe cannot scroll away
    // from the animation and leave the traveller looking at a blank edge.
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingBottom;
    body.style.overflow = "hidden";
    panel.current?.focus({ preventScroll: true });
    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingBottom = previousPadding;
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className={styles.breathOverlay} role="dialog" aria-modal="true" aria-label="3 分钟舒缓呼吸">
      <div className={styles.breathPanel} ref={panel} tabIndex={-1}>
        {children}
      </div>
      <p className={styles.breathHint}>呼吸节奏会自动循环，结束时自动回到旅程</p>
    </div>
  );
}
