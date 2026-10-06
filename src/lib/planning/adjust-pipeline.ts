import type { Journey } from "../journey-types";
import { bodyStatus } from "../adjust/status";
import { dayLoad } from "../adjust/tags";
import { instantProposals } from "../adjust/rules";
import { markConflicts, mergeProposals, parseAdvisorProposals, type ReliefSource, type RouteFact } from "../adjust/validate";
import type { AdjustScope, Proposal, Stance } from "../adjust/types";
import type { AdjustmentRequest } from "../adjust/request";
import { buildStageInput, normalizePlannerError, type HealthInsight, type PlanningProvider, type StageContext, type PlanStage } from "./contract";
import { STAGE_BY_NAME } from "./stages";
import type { RunPlanningRequest, StageReport } from "./pipeline";

export type AdjustmentCandidate = { kind: "adjustment"; scope: AdjustScope; stance: Stance; proposals: Proposal[]; stages: StageReport[]; requestedAt: string };
export type AdjustmentGathered = { health: HealthInsight | null; sources: ReliefSource[]; instant: Proposal[]; scope: AdjustScope; stance: Stance; routes?: RouteFact[] };
export type RunAdjustmentRequest = RunPlanningRequest & { journey: Journey; adjustment: AdjustmentRequest; provider?: PlanningProvider };

/** Parallel advice remains optional: even total provider failure yields usable rules. */
export async function runAdjustments(request: RunAdjustmentRequest): Promise<AdjustmentCandidate> {
  const { journey, adjustment, input, signal, progress } = request;
  const itinerary = journey.plan!.plan.itinerary;
  const trip = journey.draft.trip!;
  const planSignal = AbortSignal.any([signal, AbortSignal.timeout(90_000)]);
  const stages: StageReport[] = [];
  let provider = request.provider;
  if (!provider) {
    try { provider = (await import("./providers")).resolvePlanningProvider(); }
    catch { /* Rules require no provider configuration. */ }
  }
  const status = bodyStatus({ checkIn: adjustment.checkIn, remaining: dayLoad(itinerary, adjustment.scope.date), timezoneShiftHours: journey.plan!.timezone.shiftMinutes / 60 });
  const scopedItems = itinerary.filter(item => item.date! >= adjustment.scope.date && item.date! <= adjustment.scope.throughDate && (item.date !== adjustment.scope.date || item.time >= adjustment.scope.fromTime))
    .map(item => ({ id: item.id!, date: item.date!, time: item.time, name: item.name, fixed: item.fixed }));
  const scopedIds = new Set(scopedItems.map(item => item.id));
  const mobilityItems = itinerary.filter((item, index) => scopedIds.has(item.id!) || (itinerary[index + 1]?.date === item.date && scopedIds.has(itinerary[index + 1]?.id ?? "")))
    .map(item => ({ id: item.id!, date: item.date!, time: item.time, name: item.name, fixed: item.fixed }));
  const preferences = { intention: input.intention, colorTone: input.colorTone, ambientPreferences: input.ambientPreferences, savedMemory: input.profileMemoryNotes, planningStyle: input.trip.planningStyle };
  const selfReport = { fatigue: adjustment.checkIn.fatigue, subjectiveStress: adjustment.checkIn.stress,
    bodyFeedback: adjustment.checkIn.tags.join(",") };
  async function execute<T>(stage: PlanStage, run: (ctx: StageContext) => Promise<T>, fallback: T): Promise<T> {
    const policy = STAGE_BY_NAME[stage], started = Date.now();
    progress({ stage, status: "running", message: `${policy.label}进行中` });
    const stageSignal = AbortSignal.any([planSignal, AbortSignal.timeout(policy.budgetMs)]);
    const ctx: StageContext = { input: buildStageInput(policy.grants, { trip: input.trip, preferences, selfReport, itinerary: stage === "mobility" ? mobilityItems : scopedItems }),
      accountId: request.accountId, requestId: request.requestId, signal: stageSignal, progress, timing: request.timing,
      fixedItems: request.fixedItems, includeWhoop: request.includeWhoop, isNearOrOngoingTrip: request.isNearOrOngoingTrip, sessionCreated: request.sessionCreated };
    try {
      const value = await (request.checkpoint ? request.checkpoint(stage, () => run(ctx)) : run(ctx));
      stageSignal.throwIfAborted();
      stages.push({ stage, label: policy.label, status: "ok", elapsedMs: Date.now() - started });
      progress({ stage, status: "ok", elapsedMs: Date.now() - started, message: `${policy.label}已完成` });
      return value;
    } catch (error) {
      signal.throwIfAborted();
      const failure = normalizePlannerError(stage, "adjustment", error, true);
      stages.push({ stage, label: policy.label, status: "degraded", reason: failure.code, elapsedMs: Date.now() - started });
      progress({ stage, status: "degraded", elapsedMs: Date.now() - started, message: `${policy.label}本次未核验，保留基础建议` });
      return fallback;
    }
  }
  const [interpretedHealth, inventory, local, mobility] = await Promise.all([
    execute("health_insight", async ctx => {
      if (!provider) throw new Error("PROVIDER_NOT_CONFIGURED");
      if (request.includeWhoop && request.isNearOrOngoingTrip) {
        const whoop = await import("../whoop-core");
        if (await whoop.readWhoopTokens(request.accountId).catch(() => null)) ctx.input.healthMetrics = await whoop.getRecentWhoopMetrics(request.accountId, { signal: ctx.signal });
      }
      // Raw records are held only inside this callback, never in checkpoints.
      return provider.healthInsight(ctx);
    }, null),
    execute("relief_inventory", async ctx => {
      if (!provider?.reliefInventory) throw new Error("RELIEF_PROVIDER_NOT_CONFIGURED");
      return provider.reliefInventory(ctx);
    }, null),
    execute("local_research", async ctx => {
      if (!provider) throw new Error("PROVIDER_NOT_CONFIGURED");
      return provider.localResearch(ctx);
    }, null),
    execute("mobility", async ctx => {
      if (!provider?.mobility) throw new Error("MOBILITY_AGENT_NOT_CONFIGURED");
      return provider.mobility(ctx);
    }, null),
  ]);
  const sources: ReliefSource[] = [...(inventory?.sources ?? []).map(source => ({ ...source, kind: "fliggy_product" as const })),
    ...(local?.services ?? []).map(source => ({ name: source.name, url: source.sourceUrl, category: source.kind, kind: "reference" as const }))].slice(0, 30);
  // Only enum facts cross the health boundary into composition; free-text
  // sensory labels or an accidental extra provider field are not forwarded.
  const health: HealthInsight | null = interpretedHealth && {
    walkingPace: interpretedHealth.walkingPace, breakFrequency: interpretedHealth.breakFrequency,
    sensoryFilters: [], basis: interpretedHealth.basis, whoopUnavailable: interpretedHealth.whoopUnavailable,
    energy: interpretedHealth.energy, needs: interpretedHealth.needs,
  };
  const expandedStatus = health ? { ...status,
    energy: status.energy ?? health.energy ?? null,
    needs: [...new Set([...status.needs, ...(health.needs ?? []).filter(need => status.energy !== "high" || !["rest", "less_walking"].includes(need))])],
  } : status;
  const healthRules = instantProposals({ itinerary, trip, scope: adjustment.scope, stance: adjustment.stance, status: expandedStatus });
  const routes = (mobility?.routes ?? []).map(route => ({ ...route,
    fromActivityName: itinerary.find(item => item.id === route.fromActivityId)?.name }));
  const mode = adjustment.stance === "save" ? "transit" : "taxi";
  const mapAdvice = healthRules.some(proposal => proposal.angle === "mobility") ? parseAdvisorProposals({ proposals: routes.flatMap(route => {
    const duration = mode === "taxi" ? route.taxiMinutes : route.transitMinutes;
    const item = itinerary.find(item => item.id === route.toActivityId);
    return duration !== undefined && item ? [{ angle: "mobility", title: `去「${item.name}」这一段，${mode === "taxi" ? "打车" : "坐公共交通"}`,
      reason: "按本次高德路线估算少走一段路。实际时间随路况变化，车费以叫车页面为准。", signals: ["preference"],
      template: "swap_move", activity_id: route.toActivityId, mode, source_index: -1 }] : [];
  }) }, { itinerary, trip, scope: adjustment.scope, sources, routes, allowWhoopSignals: false }).proposals
    .map(proposal => ({ ...proposal, id: `mobility:${proposal.id}` })) : [];
  const gathered: AdjustmentGathered = { health, sources, instant: healthRules, scope: adjustment.scope, stance: adjustment.stance, routes };
  const raw = await execute("compose_adjustments", async ctx => {
    if (!provider?.composeAdjustments) throw new Error("COMPOSER_NOT_CONFIGURED");
    return provider.composeAdjustments(ctx, gathered);
  }, null);
  const advisor = parseAdvisorProposals(raw, { itinerary, trip, scope: adjustment.scope, sources, routes, allowWhoopSignals: Boolean(health?.basis === "whoop_recent") }).proposals;
  signal.throwIfAborted();
  return { kind: "adjustment", scope: adjustment.scope, stance: adjustment.stance, proposals: markConflicts(mergeProposals(mergeProposals(healthRules, mapAdvice), advisor), itinerary, trip, adjustment.scope), stages, requestedAt: new Date().toISOString() };
}
