import { waitUntil } from "cloudflare:workers";
import { getDatabase } from "./database";
import { deleteBailianSession, getBailianConfig } from "./bailian";

/** Persist immediately after creation so a process crash still releases it. */
export async function registerSessionCleanup(sessionId: string) {
  await getDatabase().prepare("INSERT OR IGNORE INTO agent_session_cleanup(session_id) VALUES(?)").bind(sessionId).run();
}

export async function queueSessionCleanup(sessionId: string) {
  await getDatabase().prepare("UPDATE agent_session_cleanup SET next_attempt_at=unixepoch() WHERE session_id=?").bind(sessionId).run();
  // waitUntil is request-scoped; a Workflow may have no request context. In
  // that case the already committed receipt is picked up by the scheduled job.
  const work = drainSessionCleanup(sessionId);
  try { waitUntil(work); }
  catch { void work.catch(() => undefined); /* Durable queue remains authoritative. */ }
}

export async function drainSessionCleanup(sessionId: string) {
  const config = getBailianConfig();
  if (!config) return;
  const db = getDatabase();
  const lease = await db.prepare(`UPDATE agent_session_cleanup SET next_attempt_at=unixepoch()+30
    WHERE session_id=? AND next_attempt_at<=unixepoch() RETURNING attempts`).bind(sessionId).first<{ attempts: number }>();
  if (!lease) return;
  const result = await deleteBailianSession(config, sessionId);
  if (result.confirmed) await db.prepare("DELETE FROM agent_session_cleanup WHERE session_id=?").bind(sessionId).run();
  else await db.prepare("UPDATE agent_session_cleanup SET attempts=attempts+1,last_status=?,next_attempt_at=unixepoch()+? WHERE session_id=?")
    .bind(result.status, Math.min(3600, 60 * 2 ** Math.min(lease.attempts, 6)), sessionId).run();
  console.info("[BioTrip session cleanup]", { state: result.confirmed ? "completed" : "retry_queued", status: result.status, attempts: lease.attempts + 1 });
}

export async function drainSessionCleanups() {
  const db = getDatabase();
  const pending = await db.prepare("SELECT session_id FROM agent_session_cleanup WHERE next_attempt_at<=unixepoch() ORDER BY next_attempt_at LIMIT 40")
    .all<{ session_id: string }>();
  for (let start = 0; start < pending.results.length; start += 4) {
    await Promise.allSettled(pending.results.slice(start, start + 4).map(row => drainSessionCleanup(row.session_id)));
  }
  await db.prepare("DELETE FROM travel_search_runs WHERE expires_at<unixepoch()").run();
}
