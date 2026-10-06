import type { ItineraryItem, ItineraryOperation } from "../itinerary-edit";
import type { ActivityKind, JourneyTripDraft } from "../journey-types";
import { feasible, reflow, ReflowError } from "./reflow";
import { activityTags } from "./tags";
import {
  ANGLES, GENERIC_STOP_COPY, GENERIC_STOPS, SIGNALS,
  type AdjustScope, type AdjustTemplate, type Angle, type GenericStop, type Proposal, type ProposalEffect, type ProposalSource, type Signal, type Stance,
} from "./types";

/**
 * The boundary between what an advisor suggested and what the traveller sees.
 *
 * A model proposes by filling a flat template row. Everything a traveller could
 * act on is then rebuilt here from data the server already holds: the place and
 * its link come from the retrieved source at that index, distances and fares
 * come from the map tool's own output, and clock times come from `reflow`. A row
 * that points at a missing activity, a fixed reservation, an unretrieved source
 * or an impossible slot is dropped on its own — one bad suggestion never fails
 * the rest.
 */

export type ReliefSource = { name: string; url: string; category: string; kind: ProposalSource["kind"]; price?: string | null; imageUrl?: string };
/** Figures for reaching one activity from the one before it, read from the map tool's output. */
export type RouteFact = { toActivityId: string; fromActivityId?: string; fromActivityName?: string; km?: number; walkMinutes?: number; transitMinutes?: number; taxiMinutes?: number; taxiCostCny?: number };
export type AdvisorContext = {
  itinerary: readonly ItineraryItem[];
  trip: JourneyTripDraft;
  scope: AdjustScope;
  sources: readonly ReliefSource[];
  routes: readonly RouteFact[];
  /** False unless this run was explicitly allowed to use WHOOP records. */
  allowWhoopSignals: boolean;
};

const TEMPLATES = new Set(["swap_move", "add_stop", "replace_stop", "shift", "postpone", "shorten", "drop", "end_early"]);
// Leisure and comfort may be suggested; treatment, cure and dosage may not.
const UNSAFE_COPY = /治疗|疗效|治愈|诊断|处方|药物|剂量|降血压|降血糖|排毒|经络|康复训练|缓解疼痛|病/;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/[\r\n|｜]+/g, " ").trim();
  return trimmed && trimmed.length <= maximum && !UNSAFE_COPY.test(trimmed) ? trimmed : null;
}
function integer(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
}
function sourceKind(category: string): ActivityKind {
  return /按摩|足疗|推拿|SPA|spa|温泉|汤/.test(category) ? "relax" : /餐|食|茶|咖啡|甜品|小吃|面|火锅/.test(category) ? "meal" : "experience";
}
function priceRange(price?: string | null): [number, number] | undefined {
  const amount = Number(price?.match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(amount) && amount > 0 ? [amount, amount] : undefined;
}

function build(row: Record<string, unknown>, context: AdvisorContext): { templates: AdjustTemplate[]; effect: ProposalEffect; source?: ProposalSource } | null {
  const template = row.template;
  if (typeof template !== "string" || !TEMPLATES.has(template)) return null;
  const item = typeof row.activity_id === "string" ? context.itinerary.find((entry) => entry.id === row.activity_id) : undefined;
  const index = integer(row.source_index, 0, context.sources.length - 1);
  const candidate = index === null ? undefined : context.sources[index];
  // The index and the copied name must describe the same retrieved item.
  if (row.source_index !== -1 && row.source_index !== undefined && (!candidate || row.source_name !== candidate.name)) return null;
  const source: ProposalSource | undefined = candidate && { url: candidate.url, name: candidate.name, kind: candidate.kind,
    ...(candidate.imageUrl ? { imageUrl: candidate.imageUrl } : {}), ...(candidate.price ? { price: candidate.price } : {}) };
  const cost = priceRange(candidate?.price);

  if (template === "swap_move") {
    if (!item || !["walk", "transit", "taxi"].includes(String(row.mode))) return null;
    const mode = row.mode as "walk" | "transit" | "taxi";
    const fact = context.routes.find((route) => route.toActivityId === item.id);
    const minutes = fact && (mode === "walk" ? fact.walkMinutes : mode === "transit" ? fact.transitMinutes : fact.taxiMinutes);
    if (!fact || minutes === undefined) return { templates: [{ type: "swap_move", activityId: item.id!, mode, basis: "unverified" }], effect: { basis: "none" } };
    const fare = mode === "taxi" ? fact.taxiCostCny : undefined;
    return {
      templates: [{ type: "swap_move", activityId: item.id!, mode, minutes, basis: "amap",
        ...(fact.fromActivityId ? { fromActivityId: fact.fromActivityId, fromActivityName: fact.fromActivityName } : {}),
        ...(mode === "taxi" && fact.km !== undefined ? { km: fact.km } : {}), ...(fare !== undefined ? { costCny: fare } : {}) }],
      effect: { basis: "amap",
        ...(fact.walkMinutes !== undefined && mode !== "walk" ? { walkMinutes: -fact.walkMinutes, timeMinutes: minutes - fact.walkMinutes } : {}),
        ...(fare !== undefined ? { costCny: [fare, fare] as [number, number] } : {}) },
    };
  }
  if (template === "add_stop") {
    const minutes = integer(row.minutes, 15, 180);
    const date = item?.date ?? (typeof row.date === "string" ? row.date : "");
    const time = typeof row.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(row.time) ? row.time : undefined;
    if (minutes === null || !date || (!item && !time)) return null;
    const placement = item ? { afterActivityId: item.id! } : { time: time! };
    if (candidate) {
      const kind = sourceKind(`${candidate.category} ${candidate.name}`);
      return { source, templates: [{ type: "add_stop", date, durationMin: minutes, effort: 1, kind, name: candidate.name.slice(0, 120),
        detail: "来自本次检索的真实来源；价格、营业时间与预约以来源页面为准。", sourceUrl: candidate.url, ...placement }],
        effect: { restMinutes: minutes, timeMinutes: minutes, ...(cost ? { costCny: cost, basis: "source" as const } : { basis: "estimate" as const }) } };
    }
    // Without a retrieved source the stop may only be a generic one that names no venue.
    if (typeof row.stop !== "string" || !(GENERIC_STOPS as readonly string[]).includes(row.stop)) return null;
    return { templates: [{ type: "add_stop", date, durationMin: minutes, effort: 1, ...GENERIC_STOP_COPY[row.stop as GenericStop], ...placement }],
      effect: { restMinutes: minutes, timeMinutes: minutes, basis: "estimate" } };
  }
  if (!item) return null;
  const length = activityTags(item).durationMin;
  if (template === "replace_stop") {
    if (!candidate) return null;
    return { source, templates: [{ type: "replace_stop", activityId: item.id!, name: candidate.name.slice(0, 120), kind: sourceKind(`${candidate.category} ${candidate.name}`),
      detail: "来自本次检索的真实来源；价格、营业时间与预约以来源页面为准。", sourceUrl: candidate.url }],
      effect: cost ? { costCny: cost, basis: "source" } : { basis: "none" } };
  }
  if (template === "shift") {
    const minutes = integer(row.minutes, -180, 180);
    return minutes ? { templates: [{ type: "shift", activityId: item.id!, minutes }], effect: { basis: "none" } } : null;
  }
  if (template === "postpone") {
    if (typeof row.date !== "string" || typeof row.time !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.time)) return null;
    return { templates: [{ type: "postpone", activityId: item.id!, date: row.date, time: row.time }], effect: { timeMinutes: -length, basis: "estimate" } };
  }
  if (template === "shorten") {
    const minutes = integer(row.minutes, 15, 600);
    return minutes === null ? null : { templates: [{ type: "shorten", activityId: item.id!, durationMin: minutes }], effect: { timeMinutes: minutes - length, basis: "estimate" } };
  }
  if (template === "drop") return { templates: [{ type: "drop", activityId: item.id! }], effect: { timeMinutes: -length, basis: "estimate" } };
  return { templates: [{ type: "end_early", afterActivityId: item.id! }], effect: { basis: "none" } };
}

/** Rebuilds advisor rows into proposals, dropping any that cannot be verified or cannot fit. */
export function parseAdvisorProposals(raw: unknown, context: AdvisorContext): { proposals: Proposal[]; dropped: number } {
  const rows = record(raw) && Array.isArray(raw.proposals) ? raw.proposals.slice(0, 12) : [];
  const proposals: Proposal[] = [];
  let dropped = 0;
  rows.forEach((row, position) => {
    const title = record(row) ? text(row.title, 40) : null;
    const reason = record(row) ? text(row.reason, 200) : null;
    const built = record(row) && title && reason && (ANGLES as readonly string[]).includes(String(row.angle)) ? build(row, context) : null;
    if (!record(row) || !title || !reason || !built || !feasible(context.itinerary, built.templates, context.trip, context.scope)) { dropped += 1; return; }
    const signals = (Array.isArray(row.signals) ? row.signals : [])
      .filter((signal): signal is Signal => (SIGNALS as readonly string[]).includes(signal as string))
      .filter((signal) => context.allowWhoopSignals || !signal.startsWith("whoop_") && signal !== "steps_today");
    proposals.push({ id: `advisor:${position}`, tier: "advisor", angle: row.angle as Angle, title, reason,
      signals: [...new Set(signals)].slice(0, 4), effect: built.effect, templates: built.templates, ...(built.source ? { source: built.source } : {}) });
  });
  return { proposals: proposals.slice(0, 6), dropped: dropped + Math.max(0, proposals.length - 6) };
}

function targets(proposal: Proposal): string[] {
  return proposal.templates.flatMap((template) => "activityId" in template ? [template.activityId] : template.afterActivityId ? [template.afterActivityId] : []);
}
function signature(proposal: Proposal) {
  return proposal.templates.map((template) => `${template.type}:${"activityId" in template ? template.activityId : template.afterActivityId ?? ""}`).join("|");
}

/** A sourced advisor proposal replaces the instant one that makes the same edit to the same activity. */
export function mergeProposals(instant: readonly Proposal[], advisor: readonly Proposal[]): Proposal[] {
  const covered = new Set(advisor.map(signature));
  const kinds = new Set(advisor.flatMap((proposal) => proposal.templates.map((template) => `${proposal.angle}:${template.type}`)));
  return [...advisor, ...instant.filter((proposal) => !covered.has(signature(proposal))
    && !proposal.templates.some((template) => template.type === "add_stop" && kinds.has(`${proposal.angle}:add_stop`)))];
}

/** Two proposals conflict when accepting one makes the other impossible or rewrites the same activity. */
export function markConflicts(proposals: readonly Proposal[], itinerary: readonly ItineraryItem[], trip: JourneyTripDraft, scope: AdjustScope): Proposal[] {
  const conflicts = new Map<string, Set<string>>(proposals.map((proposal) => [proposal.id, new Set()]));
  for (let a = 0; a < proposals.length; a += 1) for (let b = a + 1; b < proposals.length; b += 1) {
    const first = proposals[a], second = proposals[b];
    if (!first.templates.length || !second.templates.length) continue;
    const shared = targets(first).some((id) => targets(second).includes(id)) && first.templates.some((template) => template.type !== "add_stop") && second.templates.some((template) => template.type !== "add_stop");
    if (shared || !feasible(itinerary, [...first.templates, ...second.templates], trip, scope)) {
      conflicts.get(first.id)!.add(second.id); conflicts.get(second.id)!.add(first.id);
    }
  }
  return proposals.map((proposal) => conflicts.get(proposal.id)!.size ? { ...proposal, conflictsWith: [...conflicts.get(proposal.id)!] } : proposal);
}

/** Resolves an accepted set against the current itinerary; a conflict among them is reported by name. */
export function resolveAccepted(proposals: readonly Proposal[], accepted: readonly string[], itinerary: readonly ItineraryItem[], trip: JourneyTripDraft, scope: AdjustScope) {
  const chosen = accepted.map((id) => {
    const proposal = proposals.find((entry) => entry.id === id);
    if (!proposal) throw new ReflowError("所选建议已失效，请重新获取。");
    return proposal;
  });
  for (const proposal of chosen) {
    const rival = chosen.find((entry) => entry !== proposal && proposal.conflictsWith?.includes(entry.id));
    if (rival) throw new ReflowError(`「${proposal.title}」与「${rival.title}」不能同时采纳，请只保留一项。`);
  }
  let current = itinerary.slice();
  const operations: ItineraryOperation[] = [];
  for (const proposal of chosen) {
    if (!proposal.templates.length) continue;
    try {
      const result = reflow(current, proposal.templates, trip, scope);
      current = result.itinerary; operations.push(...result.operations);
    } catch (error) {
      if (error instanceof ReflowError) throw new ReflowError(`「${proposal.title}」与已选的其他建议冲突：${error.message}`);
      throw error;
    }
  }
  return { operations, itinerary: current, proposals: chosen };
}

export type BundleName = "minimal" | "easy" | "treat";
export const BUNDLE_LABELS: Record<BundleName, string> = { minimal: "最小改动", easy: "省体力", treat: "犒劳自己" };

/** Deterministic presets over the proposals on offer, skipping any that conflict with one already chosen. */
export function bundle(proposals: readonly Proposal[], name: BundleName, stance: Stance): string[] {
  const disruptive = (proposal: Proposal) => proposal.templates.some((template) => ["drop", "postpone", "end_early", "replace_stop"].includes(template.type));
  const paid = (proposal: Proposal) => Boolean(proposal.effect.costCny) || proposal.templates.some((template) => template.type === "swap_move" && template.mode === "taxi");
  const wanted = proposals.filter((proposal) => proposal.templates.length && (
    name === "minimal" ? !disruptive(proposal) && !paid(proposal)
      : name === "easy" ? ["pace", "mobility", "sleep"].includes(proposal.angle) && (stance !== "save" || !paid(proposal))
        : ["relief", "food", "mobility"].includes(proposal.angle)));
  const chosen: Proposal[] = [];
  for (const proposal of name === "minimal" ? wanted.slice(0, 2) : wanted) {
    if (!chosen.some((entry) => entry.conflictsWith?.includes(proposal.id))) chosen.push(proposal);
  }
  return chosen.map((proposal) => proposal.id);
}
