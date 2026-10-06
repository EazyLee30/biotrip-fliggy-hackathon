import type { PlanningJob } from "@/lib/planning/jobs";

export class RequestError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = "RequestError"; }
}

/** A lost acknowledgement may be retried once, always with the exact same key and body. */
export async function submitPlanningJob({ request, body, signal, key = crypto.randomUUID() }: {
  request: <T>(url: string, options: RequestInit) => Promise<T>;
  body: unknown;
  signal: AbortSignal;
  key?: string;
}): Promise<PlanningJob> {
  const options = { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body), signal };
  signal.throwIfAborted();
  try { return (await request<{ job: PlanningJob }>("/api/plan/jobs", options)).job; }
  catch (error) {
    // 4xx is an explicit rejection. Retrying it cannot repair consent, auth or a version conflict.
    if (signal.aborted || (error instanceof RequestError && error.status < 500)) throw error;
    return (await request<{ job: PlanningJob }>("/api/plan/jobs", options)).job;
  }
}
