import { getDatabase } from "@/lib/database";
import {
  createJourney,
  getJourney,
  updateJourneyItinerary,
  JourneyError,
} from "@/lib/journeys";
import { restoreJourneyVersion } from "@/lib/journey-versions";
import { prepareAdjustment, preparePlanning } from "@/lib/planning/service";
import { createPlanningJob } from "@/lib/planning/jobs";
import { dispatchPlanningJob } from "@/lib/planning/dispatch";
import { adjustmentScope } from "@/lib/adjust/request";
import { CHECK_IN_TAGS, type CheckInTag } from "@/lib/adjust/types";
import { validateAnswer } from "./contract";
import { deleteMemory, memorySettings } from "./memory";
import { validateInput } from "@/lib/planner-input";
import type { ActionCard, ActionResult } from "./types";
import { memoryAllowed } from "./blocks";
import { mutateJourneyCollection } from "@/lib/journey-collections";
import { recordBodyCheckIn, recordAdjustmentOutcome, journeyBodyContext } from "@/lib/body-journey";
export async function decideAction(
  accountId: string,
  id: string,
  raw: unknown,
): Promise<ActionResult> {
  const v = raw as {
    decision?: unknown;
    includeMemory?: unknown;
    includeWhoop?: unknown;
  };
  if (
    !v ||
    !["apply", "discard"].includes(String(v.decision)) ||
    (v.includeMemory !== undefined && typeof v.includeMemory !== "boolean") ||
    (v.includeWhoop !== undefined && typeof v.includeWhoop !== "boolean")
  )
    throw new JourneyError(400, "INVALID_ACTION", "请确认方案与本次数据用途。");
  const settings = await memorySettings(accountId);
  const includeMemory =
    memoryAllowed(settings.useMemory, v.includeMemory);
  const includeWhoop =
    settings.useWhoop && v.includeWhoop !== false;
  const db = getDatabase();
  const row = await db
    .prepare("SELECT * FROM agent_actions WHERE id=? AND account_id=?")
    .bind(id, accountId)
    .first<{
      conversation_id: string;
      payload_json: string;
      state: ActionCard["state"];
      result_json: string | null;
    }>();
  if (!row) throw new JourneyError(404, "ACTION_NOT_FOUND", "这份建议不存在。");
  if (row.state === "applied") {
    if (v.decision === "discard")
      throw new JourneyError(
        409,
        "ACTION_ALREADY_APPLIED",
        "这份方案已经应用，请通过版本历史恢复原安排。",
      );
    return JSON.parse(row.result_json ?? "{}");
  }
  if (row.state !== "proposed")
    throw new JourneyError(
      409,
      "ACTION_NOT_AVAILABLE",
      row.state === "applying"
        ? "操作已提交，请刷新旅程与任务，勿重复应用。"
        : "这份建议已失效，请重新对话生成。",
    );
  if (v.decision === "discard") {
    await db
      .prepare(
        "UPDATE agent_actions SET state='discarded' WHERE id=? AND account_id=? AND state='proposed'",
      )
      .bind(id, accountId)
      .run();
    return {};
  }
  const { action, verifiedSources, verifiedOffers } = JSON.parse(row.payload_json) as ActionCard;
  const locked = await db
    .prepare(
      "UPDATE agent_actions SET state='applying' WHERE id=? AND account_id=? AND state='proposed' RETURNING id",
    )
    .bind(id, accountId)
    .first();
  if (!locked)
    throw new JourneyError(409, "ACTION_IN_PROGRESS", "这份方案正在应用。");
  try {
    let result: ActionResult = {};
    if ("journeyId" in action) {
      const latest = await getJourney(accountId, action.journeyId);
      if (latest.version !== action.version)
        throw new JourneyError(
          409,
          "JOURNEY_CHANGED",
          "行程已被修改。请重新发送要求，助手会基于最新版本生成建议。",
        );
    }
    if (action.type === "edit") {
      validateAnswer(
        { reply: "核对当前安排", action },
        await getJourney(accountId, action.journeyId),
        verifiedSources,
      );
      result = {
        journey: await updateJourneyItinerary(accountId, action.journeyId, {
          version: action.version,
          operations: action.operations,
        }, verifiedOffers),
      };
    }
    if (action.type === "collection") {
      await mutateJourneyCollection(accountId, action.journeyId, { ...action, expectedVersion: action.version, requestId: id });
      result = { collectionsChanged: true };
    }
    if (action.type === "checkin") {
      await recordBodyCheckIn(accountId, action.journeyId, { fatigue: action.fatigue, stress: action.stress ?? null, tags: action.tags, consent: true }, id, new Date(), action.version);
      result = { bodyChanged: true };
    }
    if (action.type === "feedback") {
      const saved = await recordAdjustmentOutcome(accountId, action.journeyId, action.adjustmentId, { version: action.version, feeling: action.feeling, fatigue: action.fatigue, stress: action.stress, note: action.note }, id);
      result = { journey: saved.journey, bodyChanged: true };
    }
    if (action.type === "restore")
      result = {
        journey: await restoreJourneyVersion(
          accountId,
          action.journeyId,
          action.version,
          action.restoreVersion,
        ),
      };
    if (action.type === "forget") {
      await deleteMemory(accountId, action.memoryId);
      result = { forgotten: true };
    }
    if (
      action.type === "create" ||
      action.type === "plan" ||
      action.type === "consult"
    ) {
      const journey =
        action.type === "create"
          ? await createJourney(accountId, { draft: action.draft })
          : await getJourney(accountId, action.journeyId);
      result = { journey };
      if (action.type === "create")
        await db
          .prepare(
            "UPDATE agent_conversations SET journey_id=? WHERE id=? AND account_id=?",
          )
          .bind(journey.id, row.conversation_id, accountId)
          .run();
      // Checkpoint newly created draft before dispatch: a lost response must not create it twice.
      if (action.type === "create")
        await db
          .prepare(
            "UPDATE agent_actions SET result_json=? WHERE id=? AND account_id=?",
          )
          .bind(JSON.stringify(result), id, accountId)
          .run();
      let body: Record<string, unknown> | null = null;
      if (action.type === "consult") {
        const currentBody = (await journeyBodyContext(accountId, journey.id)).current;
        body = {
          mode: "adjust",
          journeyId: journey.id,
          expectedVersion: journey.version,
          consent: true,
          includeMemory,
          includeWhoop,
          checkIn: {
            fatigue: currentBody?.fatigue ?? null,
            stress: currentBody?.stress ?? null,
            tags: [...new Set([...(currentBody?.tags ?? []), ...action.tags])].filter((tag): tag is CheckInTag =>
              CHECK_IN_TAGS.includes(tag as CheckInTag),
            ),
          },
          stance: "balanced",
          scope: adjustmentScope(journey),
          instruction: action.instruction,
        };
      } else {
        const draft = { ...action.draft, consent: true };
        if (validateInput(draft))
          body = {
            ...draft,
            journeyId: journey.id,
            expectedVersion: journey.version,
            includeMemory,
            includeWhoop,
          };
        else if (action.type === "create")
          result.notice =
            "草稿已保存。出发地、日期或旅行条件尚不完整，补充后即可生成行程。";
        else if (action.type === "plan")
          throw new JourneyError(
            400,
            "INCOMPLETE_TRIP",
            "规划条件还不完整，请补充后再试。",
          );
      }
      if (body) {
        if (body.mode === "adjust") await prepareAdjustment(accountId, body);
        else await preparePlanning(accountId, body);
        const { job } = await createPlanningJob(accountId, id, body);
        result.jobId = job.id;
        await db
          .prepare(
            "UPDATE agent_actions SET result_json=? WHERE id=? AND account_id=?",
          )
          .bind(JSON.stringify(result), id, accountId)
          .run();
        if (job.state === "queued")
          await dispatchPlanningJob(job.id).catch(() => undefined);
      }
    }
    await db
      .prepare(
        "UPDATE agent_actions SET state='applied',result_json=? WHERE id=? AND account_id=?",
      )
      .bind(JSON.stringify(result), id, accountId)
      .run();
    return result;
  } catch (error) {
    // Once there is a checkpoint, preserve it for recovery instead of retrying writes.
    const checkpoint = await db
      .prepare(
        "SELECT result_json FROM agent_actions WHERE id=? AND account_id=?",
      )
      .bind(id, accountId)
      .first<{ result_json: string | null }>();
    if (checkpoint?.result_json) {
      const result: ActionResult = {
        ...JSON.parse(checkpoint.result_json),
        notice: `草稿已保存，但规划未完成：${error instanceof JourneyError ? error.message : "服务暂时不可用，请稍后重试。"}`,
        state: action.type === "create" ? "applied" : "failed",
      };
      await db
        .prepare(
          "UPDATE agent_actions SET state=?,result_json=? WHERE id=? AND account_id=?",
        )
        .bind(result.state!, JSON.stringify(result), id, accountId)
        .run();
      return result;
    }
    await db
      .prepare(
        "UPDATE agent_actions SET state='failed' WHERE id=? AND account_id=?",
      )
      .bind(id, accountId)
      .run();
    throw error;
  }
}
