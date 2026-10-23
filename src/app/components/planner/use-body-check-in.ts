"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BodyCheckIn, Journey } from "@/lib/journey-types";

type Snapshot = { checkIns: BodyCheckIn[]; current: BodyCheckIn | null; localDate: string; timezone: string; asOf: string };
type Request = <T>(url: string, options?: RequestInit) => Promise<T>;

export function useBodyCheckIn(journey: Journey | null, request: Request) {
  const [snapshot, setSnapshot] = useState<{ key: string; data: Snapshot } | null>(null);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const journeyId = journey?.id;
  const selected = useRef(journeyId);
  useEffect(() => { selected.current = journeyId; }, [journeyId]);
  const timezone = journey?.draft.trip?.destinationTimezone || "Asia/Shanghai";
  const [clock, setClock] = useState(() => Date.now());
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(clock);
  const key = `${journey?.id || ""}:${localDate}`;
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    const visible = () => { if (document.visibilityState === "visible") { setClock(Date.now()); reload(); } };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("biotrip:body-changed",reload);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", visible); window.removeEventListener("biotrip:body-changed",reload); };
  }, [reload]);
  useEffect(() => {
    if (!journeyId) return;
    const controller = new AbortController();
    request<Snapshot>(`/api/journeys/${journeyId}/body-check-ins`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) { setSnapshot({ key, data }); setError(""); } })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "暂时无法读取身体记录。"); });
    return () => controller.abort();
  }, [journeyId, key, request, revision]);
  const save = useCallback(async (value: string) => {
    if (!journeyId || lock.current) return;
    lock.current = true; setSaving(true); setError("");
    const id = journeyId;
    try {
      const data = await request<Snapshot>(`/api/journeys/${id}/body-check-ins`, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ fatigue: Number(value), stress: null, tags: [], consent: true }),
      });
      if (selected.current === id) setSnapshot({ key: `${id}:${data.localDate}`, data });
    } catch (caught) { if (selected.current === id) setError(caught instanceof Error ? caught.message : "评分没有保存，请重试。"); }
    finally { lock.current = false; setSaving(false); }
  }, [journeyId, request]);
  const data = snapshot?.key === key ? snapshot.data : null;
  return { current: data?.current ?? null, history: data?.checkIns ?? [], fatigue: data?.current?.fatigue ? String(data.current.fatigue) : "", localDate, timezone, saving, error, save, reload };
}
