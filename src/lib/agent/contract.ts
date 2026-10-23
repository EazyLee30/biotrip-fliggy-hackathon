import {
  applyItineraryOperations,
  type ItineraryOperation,
} from "@/lib/itinerary-edit";
import { parseJourneyDraft, JourneyError } from "@/lib/journeys";
import { destinationClock } from "@/lib/adjust/request";
import { PLACES } from "@/lib/places";
import type { Journey } from "@/lib/journey-types";
import type { AgentAnswer, AgentAction, ActionCard } from "./types";
import { validateMemory } from "./memory";
import { questionBlocks } from "./blocks";
const invalid = (message: string): never => {
  throw new JourneyError(502, "INVALID_AGENT_OUTPUT", message);
};
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
export function validateAnswer(
  raw: unknown,
  journey: Journey | null,
  verifiedSources: string[] = [],
): AgentAnswer {
  if (
    !object(raw) ||
    typeof raw.reply !== "string" ||
    !raw.reply.trim() ||
    raw.reply.length > 6000
  )
    return invalid("助手返回了不完整的内容，请重试。");
  const answer: AgentAnswer = {
    reply: raw.reply,
    title: typeof raw.title === "string" ? raw.title.slice(0, 100) : "调整建议",
    summary: typeof raw.summary === "string" ? raw.summary.slice(0, 1000) : "",
    blocks: questionBlocks(raw.blocks),
  };
  if (raw.action != null) {
    if (!object(raw.action)) return invalid("助手操作格式无效。");
    const a = raw.action;
    if (
      ["edit", "plan", "consult", "restore", "collection", "checkin", "feedback"].includes(String(a.type)) &&
      (!journey || a.journeyId !== journey.id || a.version !== journey.version)
    )
      return invalid("助手选择的旅程或版本已变化，请重新发送。");
    switch (a.type) {
      case "edit": {
        if (
          !journey?.plan ||
          !journey.planCurrent ||
          journey.status === "completed" ||
          !Array.isArray(a.operations)
        )
          return invalid("当前旅程无法修改。");
        // Models only name stable IDs. Resolve positions on the authoritative snapshot.
        const rows = journey.plan.plan.itinerary;
        const now = destinationClock(
          journey.draft.trip?.destinationTimezone || "Asia/Shanghai",
        );
        const isPast = (date: string | undefined, time: string) =>
          date
            ? date < now.date || (date === now.date && time < now.time)
            : false;
        let current = rows;
        const operations: ItineraryOperation[] = [];
        for (const rawOp of a.operations) {
          if (!object(rawOp)) return invalid("调整项目无效。");
          const op = { ...rawOp };
          if (op.type !== "add") {
            const index = current.findIndex((row) => row.id === op.activityId);
            if (index < 0) return invalid("无法定位需要修改的活动。");
            if (isPast(current[index].date, current[index].time))
              return invalid("已发生的活动不能通过助手修改。");
            if (current[index].fixed)
              return invalid("固定预约需要在手动编辑中单独确认。");
            op.index = index;
            if (op.type === "move") {
              const to = current.findIndex((row) => row.id === op.toActivityId);
              if (to < 0) return invalid("移动目标无效。");
              op.toIndex = to;
            }
          }
          if (
            op.date &&
            isPast(
              String(op.date),
              typeof op.time === "string" ? op.time : "23:59",
            )
          )
            return invalid("不能把活动安排到过去。");
          if (op.sourceUrl !== undefined) {
            const known = new Set([
              ...journey.plan.plan.places.map((p) => p.url),
              ...journey.plan.localServices.map((p) => p.sourceUrl),
              ...verifiedSources,
            ]);
            if (typeof op.sourceUrl !== "string" || !known.has(op.sourceUrl))
              return invalid("活动来源未经检索核验。");
          }
          if (op.fixed === true || op.confirmFixed === true)
            return invalid("助手不能自动确认固定预约变更。");
          const result = applyItineraryOperations(
            current,
            [op as ItineraryOperation],
            journey.draft.trip ?? {},
          );
          if (
            result.reservationChanges.some(
              (change) => change.before.fixed || change.after?.fixed,
            )
          )
            return invalid("这次调整涉及固定预约，请使用手动编辑。");
          for (const row of result.itinerary) {
            const before = current.find((r) => r.id === row.id);
            if (
              (!before ||
                before.date !== row.date ||
                before.time !== row.time) &&
              isPast(row.date, row.time)
            )
              return invalid("不能把活动安排到过去。");
          }
          current = result.itinerary;
          operations.push(op as ItineraryOperation);
        }
        if (!operations.length || operations.length > 30)
          return invalid("请将修改控制在 30 项以内。");
        answer.action = {
          type: "edit",
          journeyId: journey.id,
          version: journey.version,
          operations,
        };
        break;
      }
      case "create":
      case "plan": {
        const parsed = parseJourneyDraft(a.draft);
        const draft = parseJourneyDraft({
          intention: "未指定",
          colorTone: "未指定",
          fatigue: null,
          subjectiveStress: null,
          ambientPreferences: [],
          profileMemoryNotes: "",
          ...parsed,
          consent: false,
          trip: {
            planningStyle: "flexible",
            paceLevel: "balanced",
            itineraryText: "",
            requestedServices: [
              "hotels",
              "attractions",
              "transport",
              "local_food",
            ],
            foodPreferences: "",
            returnDate: "",
            ...parsed.trip,
          },
        });
        for (const key of ["originCity", "destinationCity"] as const) {
          const city = draft.trip?.[key];
          const match = PLACES.find(
            (p) => p.city === city || p.aliases?.includes(city ?? ""),
          );
          if (match && draft.trip)
            draft.trip[
              key === "originCity" ? "departureTimezone" : "destinationTimezone"
            ] = match.timezone;
        }
        answer.action =
          a.type === "create"
            ? { type: "create", draft }
            : {
                type: "plan",
                journeyId: journey!.id,
                version: journey!.version,
                draft,
              };
        break;
      }
      case "consult":
        if (typeof a.instruction !== "string" || a.instruction.length > 1000)
          return invalid("调整描述过长。");
        answer.action = {
          type: "consult",
          journeyId: journey!.id,
          version: journey!.version,
          instruction: a.instruction,
          tags: Array.isArray(a.tags)
            ? a.tags
                .filter((v): v is string => typeof v === "string")
                .slice(0, 6)
            : [],
        };
        break;
      case "restore":
        if (!Number.isInteger(a.restoreVersion) || Number(a.restoreVersion) < 1)
          return invalid("历史版本无效。");
        answer.action = {
          type: "restore",
          journeyId: journey!.id,
          version: journey!.version,
          restoreVersion: Number(a.restoreVersion),
        };
        break;
      case "forget":
        if (typeof a.memoryId !== "string") return invalid("记忆无效。");
        answer.action = { type: "forget", memoryId: a.memoryId };
        break;
      case "collection": {
        if (!["add", "check", "remove"].includes(String(a.operation))) return invalid("清单操作无效。");
        if (a.operation === "add" && (!["backlog", "checklist"].includes(String(a.kind)) || !Array.isArray(a.items) || !a.items.length || a.items.length > 20 || a.items.some(item => !object(item) || typeof item.title !== "string" || !item.title.trim() || item.title.length > 160 || (item.detail !== undefined && (typeof item.detail !== "string" || item.detail.length > 1000))))) return invalid("请提供简短的旅行清单。");
        if (a.operation !== "add" && (typeof a.id !== "string" || (a.operation === "check" && typeof a.checked !== "boolean"))) return invalid("请选择具体的清单项目。");
        answer.action = { type: "collection", journeyId: journey!.id, version: journey!.version, operation: a.operation as "add" | "check" | "remove", ...(a.operation === "add" ? { kind: a.kind as "backlog" | "checklist", items: (a.items as Array<{ title: string; detail?: string }>).map(item => ({ title: item.title, detail: item.detail })) } : { id: a.id as string, checked: a.checked as boolean | undefined }) };
        break;
      }
      case "feedback":
        if (typeof a.adjustmentId !== "string" || !["lighter", "same", "still_tired"].includes(String(a.feeling)) || [a.fatigue, a.stress].some(value => value != null && (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 5)) || (a.note !== undefined && (typeof a.note !== "string" || a.note.length > 500))) return invalid("请确认调整后的具体感受。");
        answer.action = { type: "feedback", journeyId: journey!.id, version: journey!.version, adjustmentId: a.adjustmentId, feeling: a.feeling as "lighter" | "same" | "still_tired", fatigue: a.fatigue == null ? null : Number(a.fatigue), stress: a.stress == null ? null : Number(a.stress), note: typeof a.note === "string" ? a.note : "" };
        break;
      case "checkin":
        if (!Number.isInteger(a.fatigue) || Number(a.fatigue) < 1 || Number(a.fatigue) > 5 || (a.stress != null && (!Number.isInteger(a.stress) || Number(a.stress) < 1 || Number(a.stress) > 5))) return invalid("身体自评需使用 1–5 档。");
        answer.action = { type: "checkin", journeyId: journey!.id, version: journey!.version, fatigue: Number(a.fatigue), stress: a.stress == null ? null : Number(a.stress), tags: Array.isArray(a.tags) ? a.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 6) : [] };
        break;
      default:
        return invalid("助手提出了不支持的操作。");
    }
  }
  if (Array.isArray(raw.memories))
    answer.memories = raw.memories.slice(0, 5).map((m) => {
      if (
        !object(m) ||
        typeof m.key !== "string" ||
        !m.key.trim() ||
        m.key.length > 100
      )
        return invalid("记忆格式无效。");
      const memory = validateMemory(m);
      if (memory.scope !== "global" && memory.journeyId !== journey?.id)
        return invalid("临时记忆不能属于其他旅程。");
      return {
        ...memory,
        key: m.key,
        ...(typeof m.replacesId === "string"
          ? { replacesId: m.replacesId }
          : {}),
      };
    });
  return answer;
}
export function actionPreview(
  action: AgentAction,
  journey: Journey | null,
  restored?: import("@/lib/journey-types").JourneyGeneratedPlan,
): ActionCard["preview"] {
  if (!journey?.plan || (action.type !== "edit" && action.type !== "restore"))
    return undefined;
  const before = journey.plan.plan.itinerary,
    after =
      action.type === "restore"
        ? (restored?.plan.itinerary ?? before)
        : applyItineraryOperations(
            before,
            action.operations,
            journey.draft.trip ?? {},
          ).itinerary;
  const text = (r: (typeof before)[number]) =>
    `${r.date ?? ""} ${r.time} ${r.name}${r.durationMin ? ` · ${r.durationMin} 分钟` : ""}${r.detail ? ` · ${r.detail.slice(0, 120)}` : ""}`;
  return [
    ...before
      .filter((r) => !after.some((a) => a.id === r.id))
      .map((r) => ({ before: text(r), after: "移除" })),
    ...after
      .filter((r) => {
        const old = before.find((a) => a.id === r.id);
        return !old || JSON.stringify(old) !== JSON.stringify(r);
      })
      .map((r) => ({
        before: before.find((a) => a.id === r.id)
          ? text(before.find((a) => a.id === r.id)!)
          : "新增",
        after: text(r),
      })),
  ];
}

/** Retrieval and memory requests do not alter an itinerary. Replanning an existing
 * plan only prepares a candidate; the job still requires approval before applying. */
export function requiresItineraryApproval(
  action: AgentAction,
  hasPlan: boolean,
): boolean {
  return (
    action.type === "create" ||
    action.type === "edit" ||
    action.type === "restore" ||
    action.type === "collection" ||
    action.type === "checkin" ||
    action.type === "feedback" ||
    (action.type === "plan" && !hasPlan)
  );
}
