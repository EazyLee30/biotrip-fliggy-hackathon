"use client";

import { useState, type RefObject } from "react";
import type { Journey, JourneyDraft, JourneyGeneratedPlan } from "@/lib/journey-types";
import type { PlanningJob } from "@/lib/planning/jobs";
import type { JourneyVersion } from "@/lib/journey-versions";
import { clearPendingReservations } from "./pending-reservations";

export function usePlanDecisions({ alive, latestJourney, session, lockRef, blocked, request, replaceJourney, fillDraft, setBusy, setError, setToast, setPreviousPlan }: {
  alive: RefObject<boolean>; latestJourney: RefObject<Journey | null>; session: RefObject<number>; lockRef: RefObject<boolean>; blocked: boolean;
  request: <T>(url: string, options?: RequestInit) => Promise<T>;
  replaceJourney: (journey: Journey) => void; fillDraft: (draft: JourneyDraft) => void;
  setBusy: (busy: boolean) => void; setError: (error: string) => void; setToast: (toast: string) => void;
  setPreviousPlan: (plan: JourneyGeneratedPlan | null) => void;
}) {
  const [candidate, setCandidate] = useState<PlanningJob | null>(null);
  const [versions, setVersions] = useState<JourneyVersion[] | null>(null);
  async function run(operation: (target: Journey, current: () => boolean) => Promise<void>) {
    const target = latestJourney.current, revision = session.current;
    if (!target || blocked || lockRef.current) return;
    const current = () => alive.current && session.current === revision && latestJourney.current?.id === target.id;
    lockRef.current = true; setBusy(true); setError("");
    try { await operation(target, current); }
    catch (error) { if (current()) setError(error instanceof Error ? error.message : "操作失败，原行程仍保留。"); }
    finally { lockRef.current = false; if (alive.current) setBusy(false); }
  }
  async function decideCandidate(action: "apply" | "discard") {
    if (!candidate) return;
    const selected = candidate;
    await run(async (target, current) => {
      if (selected.journeyId !== target.id) throw new Error("待确认方案属于另一段旅程，请先切换到对应旅程。");
      const payload = await request<{ journey?: Journey }>(`/api/plan/jobs/${selected.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, version: target.version }),
      });
      if (!current()) return;
      if (payload.journey) { setPreviousPlan(target.plan ?? null); replaceJourney(payload.journey); fillDraft(payload.journey.draft); clearPendingReservations(payload.journey.id); }
      setCandidate(null); setToast(action === "apply" ? "新方案已采用，原安排可从版本历史恢复。" : "已保留当前安排。");
    });
  }
  async function showVersions() {
    await run(async (target, current) => {
      const payload = await request<{ versions: JourneyVersion[] }>(`/api/journeys/${target.id}/versions`);
      if (current()) setVersions(payload.versions);
    });
  }
  async function restoreVersion(version: number) {
    await run(async (target, current) => {
      const payload = await request<{ journey: Journey }>(`/api/journeys/${target.id}/versions`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: target.version, restoreVersion: version }),
      });
      if (!current()) return;
      replaceJourney(payload.journey); fillDraft(payload.journey.draft); clearPendingReservations(payload.journey.id);
      setVersions(null); setToast("历史安排已恢复，刚才的版本也会保留。");
    });
  }
  return { candidate, setCandidate, versions, setVersions, decideCandidate, showVersions, restoreVersion };
}
