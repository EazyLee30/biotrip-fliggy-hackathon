import { NextResponse } from "next/server";
import { getCurrentAccount, isSameOrigin } from "@/lib/auth";
import { checkJourneyForGeneration, JourneyError } from "@/lib/journeys";
import { journeyFailure, readJourneyJson } from "@/lib/journey-http";
import {
  localDateTimeAsInstant,
  parseSchedule,
  scheduleError,
  planningDateError,
  validateInput,
  type PlannerInput,
} from "@/lib/planner-input";
import { planEventStream, type PlanProgress, type PlanRecommendations } from "@/lib/plan-response";
import { saveGeneratedJourney } from "@/lib/journeys";
import type { JourneyGeneratedPlan } from "@/lib/journey-types";
import { runPlanning } from "@/lib/planning/pipeline";
import { STAGE_BY_NAME, PLAN_BUDGET_MS } from "@/lib/planning/stages";
import { reservePlanning as reservePlanningLease } from "@/lib/planning/rate-limit";
import type { TripTiming } from "@/lib/planning/contract";
import { memoryUsage } from "@/lib/planning/service";
import { resolveTripTiming } from "@/lib/trip-timing";

export const runtime = "nodejs";
export const maxDuration = 210;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store, private" } });
}

/** One planning run per account, plus an hourly ceiling to bound provider cost. */
async function reservePlanning(accountId: string, leaseSeconds: number) {
  return reservePlanningLease(accountId, leaseSeconds);
}

function isNearOrOngoingTrip(input: PlannerInput, timing: TripTiming) {
  const now = Date.now();
  const returnDayEnd = input.trip.returnDate
    ? localDateTimeAsInstant(`${input.trip.returnDate}T23:59`, input.trip.destinationTimezone).getTime()
    : timing.arrivalInstant.getTime() + 24 * 60 * 60 * 1000;
  // WHOOP describes the traveller today, so it only informs a trip that is
  // imminent or under way. A distant trip is planned as a contingency.
  return timing.departureInstant.getTime() <= now + 36 * 60 * 60 * 1000 && returnDayEnd >= now - 24 * 60 * 60 * 1000;
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
  if (record(raw) && raw.reservationEdits !== undefined) return json({error:"预约改动需要预览后确认，请从重新规划继续。",code:"PLANNING_JOB_REQUIRED"},409);
  if (record(raw) && record(raw.trip)) {
    const dateError = planningDateError(raw.trip.departureDate, raw.trip.returnDate);
    if (dateError) return json({ error: dateError }, 400);
    if (typeof raw.trip.itineraryText === "string") {
      const error = scheduleError(raw.trip.itineraryText);
      if (error) return json({ error }, 400);
    }
  }

  const parsed = validateInput(raw);
  if (!parsed || !record(raw) || (raw.includeWhoop !== undefined && typeof raw.includeWhoop !== "boolean") ||
      (raw.includeMemory !== undefined && typeof raw.includeMemory !== "boolean")) {
    return json({ error: "旅行资料暂时无法识别，请核对城市、日期、时区、偏好和本次授权。" }, 400);
  }
  let target;
  try { target = await checkJourneyForGeneration(account.id, raw.journeyId, raw.expectedVersion); }
  catch (error) { return journeyFailure(error); }
  const journeyId = target?.id;
  const expectedVersion = target?.version;
  const includeWhoop = raw.includeWhoop === true;

  let timing: TripTiming;
  try { timing = resolveTripTiming(parsed); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "行程时区无效。" }, 400); }

  const schedule = parseSchedule(parsed.trip.itineraryText) ?? [];
  for (const item of schedule) {
    if (item.date && (item.date < timing.arrivalDate || item.date > timing.endDate)) {
      return json({ error: `活动“${item.name}”的日期不在本次行程内，请选在 ${timing.arrivalDate} 至 ${timing.endDate} 之间。` }, 400);
    }
  }
  const fixedItems = schedule.filter((item) => item.fixed).map((item) => ({ ...item, date: item.date ?? timing.arrivalDate }));
  let usage: Awaited<ReturnType<typeof memoryUsage>>;
  try { usage = await memoryUsage(account.id, parsed, raw.includeMemory !== false, journeyId ?? null); }
  catch (error) { return journeyFailure(error); }
  const { input, memory } = usage;
  const requestId = crypto.randomUUID();

  const controller = new AbortController();
  const disconnect = () => controller.abort(new DOMException("Client disconnected", "AbortError"));
  if (request.signal.aborted) disconnect();
  else request.signal.addEventListener("abort", disconnect, { once: true });
  const startedAt = Date.now();

  const execute = async (progress: (event: PlanProgress) => void, recommendations: (event: PlanRecommendations) => void) => {
    // The lease is taken here, not before the response starts: a request that
    // is already disconnected must not lock the account out for the lease window.
    const lease = await reservePlanning(account.id, Math.ceil(PLAN_BUDGET_MS / 1000) + 30);
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
        recommendations,
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

      // A cancelled generation must not begin a new database commit after the
      // provider resolves; a commit already in flight is read back by the UI.
      controller.signal.throwIfAborted();
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
      await lease.release();
    }
  };

  const guarded = async (progress: (event: PlanProgress) => void, recommendations: (event: PlanRecommendations) => void = () => undefined) => {
    try {
      return await execute(progress, recommendations);
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
      const message = code === "NO_VERIFIED_FLYAI_SOURCE"
        ? "飞猪本次没有返回可核验的商品资料，请调整目的地或服务类型后重试。已保留你的草稿和原有行程。"
        : "本次规划未完成，已保留你的草稿和原有行程。请稍后重试。";
      console.error("[BioTrip plan failure]", { requestId, stage, code, status, providerRequestId: upstreamId, elapsedMs: Date.now() - startedAt });
      return json(
        {
          error: `${message} 诊断：${policy?.label ?? "行程编排"} · HTTP ${status} · ${code}${upstreamId ? ` · 请求 ID ${upstreamId}` : ""}。`,
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
