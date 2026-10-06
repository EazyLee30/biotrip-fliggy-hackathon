import type { PlanningJob } from "@/lib/planning/jobs";

export type PlanningJobUpdate = {
  job: PlanningJob;
  events: Array<{ seq: number; kind: string; payload: Record<string, unknown> }>;
};

function waitForNextRead(signal: AbortSignal, intervalMs: number): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visible);
      resolve();
    };
    const visible = () => { if (document.visibilityState === "visible") finish(); };
    const delay = typeof document !== "undefined" && document.visibilityState === "hidden" ? Math.max(intervalMs, 15000) : intervalMs;
    const timer = setTimeout(finish, delay);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", visible);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** Reads one existing job. Reconnection never submits or restarts generation. */
export async function watchPlanningJob({ signal, read, onUpdate, onReconnect, intervalMs = 1500 }: {
  signal: AbortSignal;
  read: (cursor: number, signal: AbortSignal) => Promise<PlanningJobUpdate>;
  onUpdate: (update: PlanningJobUpdate) => Promise<boolean>;
  onReconnect: () => void;
  intervalMs?: number;
}): Promise<void> {
  let cursor = 0, failures = 0;
  while (!signal.aborted) {
    try {
      const update = await read(cursor, signal);
      // A transport can finish after cancellation; never deliver its stale result.
      if (signal.aborted) return;
      failures = 0;
      for (const event of update.events) cursor = Math.max(cursor, event.seq);
      if (await onUpdate(update)) return;
    } catch (error) {
      if (signal.aborted) return;
      if (++failures >= 8) throw error;
      onReconnect();
    }
    await waitForNextRead(signal, intervalMs);
  }
}
