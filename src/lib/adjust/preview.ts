import type { ItineraryActivity } from "../journey-types";
export type AdjustmentDifference = { id: string; before: string | null; after: string | null; kind: "added" | "removed" | "changed" };
const modes: Record<string,string> = {walk:"步行",taxi:"打车",transit:"公共交通",none:"无需交通"};
function key(item: ItineraryActivity) { return item.id ?? `legacy:${item.date ?? ""}:${item.time}:${item.name}`; }
function label(item: ItineraryActivity) {
  return `${item.date ?? ""} ${item.time} ${item.name}${item.durationMin != null ? ` · ${item.durationMin} 分钟` : ""}${item.move ? ` · ${modes[item.move.mode] ?? item.move.mode}${item.move.minutes != null ? ` ${item.move.minutes} 分钟` : ""}` : ""}`.trim();
}
/** Only report observable itinerary changes, never estimate physiological improvement. */
export function adjustmentDifferences(before: readonly ItineraryActivity[], after: readonly ItineraryActivity[]): AdjustmentDifference[] {
  const originals = new Map(before.map(item=>[key(item),item]));
  const updates = new Map(after.map(item=>[key(item),item]));
  const result: AdjustmentDifference[] = [];
  for (const item of before) {
    const next=updates.get(key(item));
    if (!next) result.push({id:key(item),before:label(item),after:null,kind:"removed"});
    else if (label(item)!==label(next) || item.detail!==next.detail || item.fixed!==next.fixed) result.push({id:key(item),before:label(item),after:label(next),kind:"changed"});
  }
  for(const item of after) if(!originals.has(key(item))) result.push({id:key(item),before:null,after:label(item),kind:"added"});
  return result;
}
