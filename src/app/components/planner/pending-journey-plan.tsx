"use client";

import { useEffect, useState } from "react";
import type { PlanningJob } from "@/lib/planning/jobs";
import { ArrowRight } from "lucide-react";
import css from "./journey-overview.module.css";

type Props = {
  journeyId: string;
  version: number;
  request: <T>(url: string, options?: RequestInit) => Promise<T>;
  onOpen: (job: PlanningJob) => void;
  disabled: boolean;
};

export function PendingJourneyPlan({ journeyId, version, request, onOpen, disabled }: Props) {
  const [pending, setPending] = useState<PlanningJob | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const { jobs } = await request<{ jobs: PlanningJob[] }>("/api/plan/jobs", { signal: controller.signal });
        if (controller.signal.aborted) return;
        setPending(jobs.find(job => job.journeyId === journeyId && job.state === "awaiting_approval") ?? null);
        if (jobs.some(job => job.journeyId === journeyId && ["queued", "running", "cancel_requested"].includes(job.state))) timer = setTimeout(() => void refresh(), 10_000);
      } catch { /* Existing plans remain available when task status cannot be read. */ }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [journeyId, version, request]);
  if (!pending || pending.journeyId !== journeyId) return null;
  return <button type="button" className={css.pending} disabled={disabled} onClick={() => onOpen(pending)}><span><strong>{pending.mode === "adjust" ? "今天的调整建议已准备好" : "新的行程方案待确认"}</strong><small>查看变化，再决定是否采用</small></span><ArrowRight size={20} /></button>;
}
