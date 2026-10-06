import { createHash, randomInt } from "node:crypto";
import { getDatabase } from "@/lib/database";
import { JourneyError } from "@/lib/journeys";

/**
 * Bounds planning cost and concurrency.
 *
 * Two independent limits share the `auth_rate_limits` table: a lease that
 * allows only one in-flight generation per account, and an hourly counter.
 * Both are keyed by a digest so no account identifier is stored in the clear.
 *
 * This lives outside the route handler so the SQL can be exercised against a
 * real database in tests — a placeholder/column mismatch here otherwise only
 * surfaces as a 500 in production.
 */
export const PLANNING_HOURLY_LIMIT = 12;

export type PlanningLease = { token: number; release: () => Promise<void> };

type Database = ReturnType<typeof getDatabase>;

function digest(scope: string, accountId: string) {
  return createHash("sha256").update(`${scope}:${accountId}`).digest("hex");
}

export async function reservePlanning(
  accountId: string,
  leaseSeconds: number,
  database: Database = getDatabase(),
): Promise<PlanningLease> {
  const active = await database.prepare("SELECT id FROM planning_jobs WHERE account_id=? AND state IN ('queued','running','cancel_requested')").bind(accountId).first();
  if (active) throw new JourneyError(409, "PLANNING_IN_PROGRESS", "你的规划仍在后台执行，请恢复进度或先停止任务。");
  const now = Math.floor(Date.now() / 1000);
  const key = digest("plan:active", accountId);
  const token = randomInt(1, 2147483647);

  // The conditional upsert only succeeds once the previous lease has expired,
  // so a second concurrent request is rejected without a read-modify-write.
  const lock = await database.prepare(`INSERT INTO auth_rate_limits (limit_key, hit_count, reset_at) VALUES (?, ?, ?)
    ON CONFLICT(limit_key) DO UPDATE SET hit_count = excluded.hit_count, reset_at = excluded.reset_at
    WHERE auth_rate_limits.reset_at <= ? RETURNING hit_count`)
    .bind(key, token, now + leaseSeconds, now).first<{ hit_count: number }>();
  if (!lock) {
    throw new JourneyError(409, "PLANNING_IN_PROGRESS", "你的上一份规划仍在生成，请等待完成或取消后重试。");
  }

  // The lease is only ours while our token is still the stored one, so a lease
  // that already expired and was taken over is never released by its predecessor.
  const release = async () => {
    await database.prepare("DELETE FROM auth_rate_limits WHERE limit_key = ? AND hit_count = ?")
      .bind(key, token).run().catch(() => undefined);
  };

  try {
    const rateKey = digest("plan:hour", accountId);
    const count = await database.prepare(`INSERT INTO auth_rate_limits (limit_key, hit_count, reset_at) VALUES (?, 1, ?)
      ON CONFLICT(limit_key) DO UPDATE SET
        hit_count = CASE WHEN auth_rate_limits.reset_at <= ? THEN 1 ELSE auth_rate_limits.hit_count + 1 END,
        reset_at = CASE WHEN auth_rate_limits.reset_at <= ? THEN excluded.reset_at ELSE auth_rate_limits.reset_at END
      RETURNING hit_count`).bind(rateKey, now + 3600, now, now).first<{ hit_count: number }>();
    if (!count || count.hit_count > PLANNING_HOURLY_LIMIT) {
      throw new JourneyError(429, "PLANNING_RATE_LIMIT", "本小时规划次数已达上限，请稍后再试。已保存的旅程可继续查看和调整。");
    }
    return { token, release };
  } catch (error) {
    await release();
    throw error;
  }
}