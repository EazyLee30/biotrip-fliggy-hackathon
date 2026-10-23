"use client";
import { useEffect, useState } from "react";
import type { PlanningJob } from "@/lib/planning/jobs";
import type { Journey } from "@/lib/journey-types";
import css from "./agent.module.css";
type Request = <T>(url: string, options?: RequestInit) => Promise<T>;
export function AgentJobPanel({
  id,
  request,
  onSaved,
}: {
  id: string;
  request: Request;
  onSaved: (journey: Journey) => void;
}) {
  const [job, setJob] = useState<PlanningJob | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    async function poll() {
      try {
        const v = await request<{ job: PlanningJob }>(`/api/plan/jobs/${id}`, {
          signal: abort.signal,
        });
        if (stopped) return;
        setJob(v.job);
        if (["queued", "running", "cancel_requested"].includes(v.job.state))
          timer = setTimeout(poll, 2000);
        else if (v.job.state === "completed") {
          const j = await request<{ journey: Journey }>(
            `/api/journeys/${v.job.journeyId}`,
          );
          if (!stopped) onSaved(j.journey);
        }
      } catch (e) {
        if (!stopped) {
          setError(e instanceof Error ? e.message : "进度读取中断");
          timer = setTimeout(poll, 4000);
        }
      }
    }
    void poll();
    return () => {
      stopped = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [id, request, onSaved]);
  async function decide(action: "apply" | "discard") {
    if (!job) return;
    setBusy(true);
    setError("");
    try {
      const current = await request<{ journey: Journey }>(
        `/api/journeys/${job.journeyId}`,
      );
      const v = await request<{ job: PlanningJob; journey?: Journey }>(
        `/api/plan/jobs/${id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            version: current.journey.version,
            accept: selected,
          }),
        },
      );
      setJob(v.job);
      if (v.journey) onSaved(v.journey);
    } catch (e) {
      setError(e instanceof Error ? e.message : "应用失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={css.job}>
      {!job ? (
        <p>正在恢复后台任务…</p>
      ) : (
        <>
          <small>
            {
              (
                {
                  queued: "任务已排队",
                  running: "顾问正在准备方案，关闭对话后仍可恢复",
                  awaiting_approval: "新方案已就绪，确认后应用",
                  completed: "已保存到行程",
                  failed: "任务失败，原行程保留",
                  indeterminate: "任务中断，未自动重试",
                  cancelled: "已保留原行程",
                  cancel_requested: "正在停止任务",
                } as Record<string, string>
              )[job.state]
            }
          </small>
          {job.error && <p className={css.error}>{job.error}</p>}
          {job.state === "awaiting_approval" && (
            <>
              {job.adjustment?.proposals.map((p) => (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(p.id)}
                    onChange={(e) =>
                      setSelected((old) =>
                        e.target.checked
                          ? [...old, p.id]
                          : old.filter((id) => id !== p.id),
                      )
                    }
                  />{" "}
                  <span>
                    <strong>{p.title}</strong>
                    <br />
                    {p.reason}
                  </span>
                </label>
              ))}
              {job.candidate?.plan.itinerary && (
                <ul>
                  {job.candidate.plan.itinerary.map((a) => (
                    <li key={a.id ?? `${a.date}-${a.time}-${a.name}`}>
                      {a.date} {a.time} {a.name}
                      {a.fixed ? " · 固定预约" : ""}
                    </li>
                  ))}
                </ul>
              )}
              <div className={css.toolbar}>
                <button
                  type="button"
                  className={css.primary}
                  disabled={busy || (!!job.adjustment && !selected.length)}
                  onClick={() => void decide("apply")}
                >
                  允许应用所选方案
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide("discard")}
                >
                  拒绝，保留原行程
                </button>
              </div>
            </>
          )}
          {["queued", "running"].includes(job.state) && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const v = await request<{ job: PlanningJob }>(
                    `/api/plan/jobs/${id}`,
                    { method: "DELETE" },
                  );
                  setJob(v.job);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "停止未确认");
                } finally {
                  setBusy(false);
                }
              }}
            >
              停止任务
            </button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className={css.error}>
          {error}
        </p>
      )}
    </div>
  );
}
