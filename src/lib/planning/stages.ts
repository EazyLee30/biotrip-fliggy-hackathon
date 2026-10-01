import type { PlanStage, StagePolicy } from "./contract";

/**
 * The pipeline's only stage table.
 *
 * `grants` is the privacy contract, `degradable` is the reliability contract
 * and `budgetMs` is the cost contract. Changing planning behaviour means
 * editing one row here plus the matching provider method — never a second copy
 * of the orchestration.
 *
 * Ordering note: `flyai_inventory` runs before `compose_plan` because the
 * composer may only reference real sources, and `local_research` degrades so a
 * web-search quota can never discard verified FlyAI inventory.
 */
export const STAGE_POLICIES: readonly StagePolicy[] = [
  {
    name: "health_insight",
    label: "身体节奏分析",
    budgetMs: 75_000,
    grants: ["trip", "preferences", "self_report", "health_metrics"],
    degradable: true,
    required: false,
  },
  {
    name: "local_research",
    label: "目的地信息检索",
    budgetMs: 120_000,
    grants: ["trip", "preferences"],
    degradable: true,
    required: false,
  },
  {
    name: "flyai_inventory",
    label: "飞猪实时商品检索",
    budgetMs: 90_000,
    // The FlyAI credential is bound by the provider to a single agent session,
    // so it is deliberately absent from `grants`: credentials are never stage
    // input and can never travel through a prompt.
    grants: ["trip"],
    degradable: false,
    required: true,
  },
  {
    name: "compose_plan",
    label: "行程编排",
    budgetMs: 180_000,
    grants: ["trip", "preferences", "self_report"],
    degradable: false,
    required: true,
  },
] as const;

export const STAGE_BY_NAME: Record<PlanStage, StagePolicy> = Object.fromEntries(
  STAGE_POLICIES.map((policy) => [policy.name, policy]),
) as Record<PlanStage, StagePolicy>;

/** Total wall-clock ceiling for one planning request. */
export const PLAN_BUDGET_MS = 360_000;

/** Advisory stages that may run concurrently with each other. */
export const ADVISORY_STAGES: readonly PlanStage[] = ["health_insight", "local_research"];
