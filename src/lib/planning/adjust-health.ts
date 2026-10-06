import { NEEDS, type Need, type Energy } from "../adjust/types";
/** Only closed enums may leave the tool-free health interpreter. */
export function abstractHealth(parsed: Record<string, unknown>): { energy?: Energy; needs: Need[] } {
  const energy = ["low", "moderate", "high"].includes(String(parsed.energy)) ? parsed.energy as Energy : undefined;
  const needs = (Array.isArray(parsed.needs) ? parsed.needs : []).filter((value): value is Need => NEEDS.includes(value as Need));
  return { ...(energy ? { energy } : {}), needs: [...new Set(needs)] };
}
