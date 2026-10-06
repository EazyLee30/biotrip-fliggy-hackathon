import { PlannerError, type ComposedPlan, type StageContext } from "./contract";

/** Required date coverage and fixed entries are checked before any plan is saved. */
export function validateComposedPlan(plan: ComposedPlan, ctx: StageContext): ComposedPlan {
  const covered = new Set<string>();
  const arrivalClock = ctx.timing.arrivalLocal?.slice(11, 16);
  for (const item of plan.itinerary) {
    if (!item.date || item.date < ctx.timing.arrivalDate || item.date > ctx.timing.endDate) {
      throw new PlannerError("compose_plan", "agent_output", 502, "INVALID_PLAN_DATE_RANGE", ctx.requestId);
    }
    if (!item.fixed && item.date === ctx.timing.arrivalDate && arrivalClock && item.time < arrivalClock) {
      throw new PlannerError("compose_plan", "agent_output", 502, "PLAN_BEFORE_ARRIVAL_BUFFER", ctx.requestId);
    }
    covered.add(item.date);
  }
  for (let day = 0; day < ctx.timing.days; day += 1) {
    const date = new Date(`${ctx.timing.arrivalDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + day);
    if (!covered.has(date.toISOString().slice(0, 10))) {
      throw new PlannerError("compose_plan", "agent_output", 502, "INCOMPLETE_PLAN_DAYS", ctx.requestId);
    }
  }
  return { ...plan, itinerary: [...plan.itinerary].sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`)) };
}
