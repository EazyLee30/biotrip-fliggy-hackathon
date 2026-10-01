import { NextResponse } from "next/server";
import { createHash, randomInt } from "node:crypto";
import { getCurrentAccount, getDatabase, isSameOrigin } from "@/lib/auth";
import { JourneyError } from "@/lib/journeys";
import { journeyFailure, readJourneyJson } from "@/lib/journey-http";
import {
  localDateTimeAsInstant,
  offsetMinutesAt,
  parseSchedule,
  validateInput,
  type PlannerInput,
} from "@/lib/planner-input";
import { planEventStream, type PlanProgress } from "@/lib/plan-response";
import { saveGeneratedJourney } from "@/lib/journeys";
import type { JourneyGeneratedPlan } from "@/lib/journey-types";
import { runPlanning } from "@/lib/planning/pipeline";
import { STAGE_BY_NAME, PLAN_BUDGET_MS } from "@/lib/planning/stages";
import type { TripTiming } from "@/lib/planning/contract";
import { listLearnedPreferences, preferenceDefaults } from "@/lib/preferences";

export const runtime = "nodejs";
export const maxDuration = 360;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store, private" } });
}

/** One planning run per account, plus an hourly ceiling to bound provider cost. */
async function reservePlanning(accountId: string, leaseSeconds: number) {
  const database = getDatabase();
  const now = Math.floor(Date.now() / 1000);
  const key = createHash("sha256").update(`plan:active:${accountId}`).digest("hex");
  const token = randomInt(1, 2147483647);
  const lock = await database.prepare(`INSERT INTO auth_rate_limits (limit_key, hit_count, reset_at) VALUES (?, ?, ?)
    ON CONFLICT(limit_key) DO UPDATE SET hit_count = excluded.hit_count, reset_at = excluded.reset_at
    WHERE auth_rate_limits.reset_at <= ? RETURNING hit_count`)
    .bind(key, token, now + leaseSeconds, now).first<{ hit_count: number }>();
  if (!lock) {
    throw new JourneyError(409, "PLANNING_IN_PROGRESS", "你的上一份规划仍在生成，请等待完成或取消后重试。");
  }
  const release = async () => {
    await database.prepare("DELETE FROM auth_rate_limits WHERE limit_key = ? AND hit_count = ?")
      .bind(key, token).run().catch(() => undefined);
  };
  try {
    const rateKey = createHash("sha256").update(`plan:hour:${accountId}`).digest("hex");
    const count = await database.prepare(`INSERT INTO auth_rate_limits (limit_key, hit_count, reset_at) VALUES (?, ?, 1, ?)
      ON CONFLICT(limit_key) DO UPDATE SET
        hit_count = CASE WHEN auth_rate_limits.reset_at <= ? THEN 1 ELSE auth_rate_limits.hit_count + 1 END,
        reset_at = CASE WHEN auth_rate_limits.reset_at <= ? THEN excluded.reset_at ELSE auth_rate_limits.reset_at END
      RETURNING hit_count`).bind(rateKey, now + 3600, now, now).first<{ hit_count: number }>();
    if (!count || count.hit_count > 12) {
      throw new JourneyError(429, "PLANNING_RATE_LIMIT", "本小时规划次数已达上限，请稍后再试。已保存的旅程可继续查看和调整。");
    }
    return release;
  } catch (error) { await release(); throw error; }
}

function resolveTiming(input: PlannerInput): TripTiming {
  const departureInstant = localDateTimeAsInstant(input.trip.departureLocal, input.trip.departureTimezone);
  const arrivalInstant = localDateTimeAsInstant(input.trip.arrivalLocal, input.trip.destinationTimezone);
  if (arrivalInstant.getTime() < departureInstant.getTime()) throw new Error("抵达时间不能早于出发时间。");
  const timezoneShiftMinutes =
    offsetMinutesAt(arrivalInstant, input.trip.destinationTimezone) -
    offsetMinutesAt(departureInstant, input.trip.departureTimezone);
  const arrivalDate = input.trip.arrivalLocal.slice(0, 10);
  const endDate = input.trip.returnDate || arrivalDate;
  const days = Math.max(1, Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${arrivalDate}T00:00:00Z`)) / 86_400_000) + 1);
  return {
    departureInstant,
    arrivalInstant,
    timezoneShiftMinutes,
    travelHours: Math.round((arrivalInstant.getTime() - departureInstant.getTime()) / 3_600_000 * 10) / 10,
    arrivalDate,
    endDate,
    days,
  };
}

function isNearOrOngoingTrip(input: PlannerInput, timing: TripTiming) {
  const now = Date.now();
  const returnDayEnd = input.trip.returnDate
    ? Date.parse(`${input.trip.returnDate}T23:59:59Z`)
    : timing.arrivalInstant.getTime() + 24 * 60 * 60 * 1000;
  // WHOOP describes the traveller today, so it only informs a trip that is
  // imminent or under way. A distant trip is planned as a contingency.
  return timing.departureInstant.getTime() <= now + 36 * 60 * 60 * 1000 && returnDayEnd >= now - 24 * 60 * 60 * 1000;
}

/** Learned defaults only ever extend what the traveller explicitly confirmed. */
async function memoryUsage(accountId: string, input: PlannerInput) {
  const preferences = await listLearnedPreferences(accountId);
  const defaults = preferenceDefaults(preferences);
  const learnedNotes = defaults.notes;
  const combined = [input.profileMemoryNotes, learnedNotes.join("；")]
    .filter(Boolean).join("\n").slice(0, 5000);
  return {
    input: { ...input, profileMemoryNotes: combined },
    memory: {
      applied: Boolean(input.profileMemoryNotes || learnedNotes.length),
      source: (learnedNotes.length ? "learned" : input.profileMemoryNotes ? "profile" : "none") as "learned" | "profile" | "none",
      noteCount: learnedNotes.length,
    },
  };
}

/**
 * Route adapter only: authenticate, validate, run the pipeline, persist.
 * All planning behaviour lives in `src/lib/planning`.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return json({ error: "请求来源无效。" }, 403);
  const account = await getCurrentAccount().catch(() => null);
  if (!account) return json({ error: "请先登录。" }, 401);
  let raw: unknown;
  try { raw = await readJourneyJson(request); } catch (error) { return journeyFailure(error); }

  const parsed = validateInput(raw);
  if (!parsed || !record(raw) || (raw.includeWhoop !== undefined && typeof raw.includeWhoop !== "boolean")) {
    return json({ error: "行程时间、时区、偏好或授权无效。日程请使用“时间 | 地点/活动 | 固定/灵活”格式。" }, 400);
  }
  const journeyId = typeof raw.journeyId === "string" ? raw.journeyId : undefined;
  const expectedVersion = typeof raw.expectedVersion === "number" ? raw.expectedVersion : undefined;
  const includeWhoop = raw.includeWhoop === true;

  let timing: TripTiming;
  try { timing = resolveTiming(parsed); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "行程时区无效。" }, 400); }

  const fixedItems = parseSchedule(parsed.trip.itineraryText)?.filter((item) => item.fixed) ?? [];
  const { input, memory } = await memoryUsage(account.id, parsed);
  const requestId = crypto.randomUUID();
  const release = await reservePlanning(account.id, Math.ceil(PLAN_BUDGET_MS / 1000) + 30);

  const controller = new AbortController();
  const disconnect = () => controller.abort(new DOMException("Client disconnected", "AbortError"));
  if (request.signal.aborted) disconnect();
  else request.signal.addEventListener("abort", disconnect, { once: true });
  const startedAt = Date.now();

  const execute = async (progress: (event: PlanProgress) => void) => {
    try {
      const outcome = await runPlanning({
        accountId: account.id,
        input,
        timing,
        fixedItems,
        includeWhoop,
        isNearOrOngoingTrip: isNearOrOngoingTrip(input, timing),
        requestId,
        signal: controller.signal,
        progress,
        memory,
      });

      const generated: JourneyGeneratedPlan = {
        source: "live",
        retrievedAt: outcome.provenance.requestedAt,
        timezone: { shiftMinutes: timing.timezoneShiftMinutes, travelHours: timing.travelHours },
        healthContext: {
          basis: outcome.provenance.health.basis,
          provisional: outcome.provenance.health.basis !== "whoop_recent",
        },
        localServices: outcome.local?.services ?? [],
        plan: outcome.plan,
        provenance: outcome.provenance,
      };
      // A category that could not be verified must read as unverified.
      const unverified = [
        ...outcome.inventory.failedCategories,
        ...(outcome.provenance.local.reason ? [outcome.provenance.local.reason] : []),
      ];
      if (unverified.length) {
        generated.plan.adjustments.push(`${unverified.join("、")}本次未核验，请自行确认后再使用。`);
      }
      if (outcome.provenance.health.whoopUnavailable) {
        generated.plan.adjustments.push("WHOOP 授权已失效，本次按你的自评规划；可在个人档案重新连接。");
      }

      const journey = await saveGeneratedJourney(account.id, {
        ...(journeyId ? { journeyId, expectedVersion } : {}),
        draft: input,
        generated,
      });
      progress({ stage: "complete", message: "规划已生成并保存到你的旅程" });
      console.info("[BioTrip planning evidence]", {
        requestId, provider: outcome.provenance.provider, elapsedMs: Date.now() - startedAt,
        stages: outcome.provenance.stages.map(({ stage, status, elapsedMs }) => ({ stage, status, elapsedMs })),
        flyai: outcome.provenance.flyai, localVerified: outcome.provenance.local.verified,
        healthBasis: outcome.provenance.health.basis, memory: outcome.provenance.memory.source,
      });
      return json({ ...generated, journey });
    } finally {
      await release();
    }
  };

  const guarded = async (progress: (event: PlanProgress) => void) => {
    try {
      return await execute(progress);
    } catch (error) {
      if (error instanceof JourneyError) return journeyFailure(error);
      const stage = error && typeof error === "object" && "stage" in error && typeof error.stage === "string"
        ? error.stage : "compose_plan";
      const policy = STAGE_BY_NAME[stage as keyof typeof STAGE_BY_NAME];
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code : "PLANNING_FAILED";
      const status = error && typeof error === "object" && "status" in error && typeof error.status === "number"
        ? error.status : 502;
      const upstreamId = error && typeof error === "object" && "requestId" in error && typeof error.requestId === "string"
        ? error.requestId : null;
      console.error("[BioTrip plan failure]", { requestId, stage, code, status, providerRequestId: upstreamId, elapsedMs: Date.now() - startedAt });
      return json(
        {
          error: `实时规划服务未能完成。诊断：${policy?.label ?? "行程编排"} · HTTP ${status} · ${code}${upstreamId ? ` · 请求 ID ${upstreamId}` : ""}。本次没有生成演示结果，也未改变你的原始行程。`,
          diagnostic: { stage, status, code, requestId: upstreamId },
        },
        status >= 400 && status < 600 ? status : 502,
      );
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", disconnect);
      controller.abort();
      console.info("[BioTrip plan finished]", { requestId, elapsedMs: Date.now() - startedAt });
    }
  };

  const timer = setTimeout(
    () => controller.abort(new DOMException("Plan budget exceeded", "TimeoutError")),
    PLAN_BUDGET_MS,
  );
  if (request.headers.get("Accept")?.includes("text/event-stream")) {
    return planEventStream(guarded, disconnect, request.signal);
  }
  return guarded(() => undefined);
}
