import type { ItineraryItem } from "./itinerary-edit";

/** Pair each activity once. Legacy snapshots use the old exact-content fallback. */
export function compareItineraries(before: readonly ItineraryItem[], after: readonly ItineraryItem[]) {
  const used = new Set<number>();
  const added: ItineraryItem[] = [], retained: ItineraryItem[] = [];
  const changed: Array<{ before: ItineraryItem; after: ItineraryItem }> = [];
  const legacyKey = (item: ItineraryItem) => JSON.stringify([item.date, item.time, item.name]);
  for (const item of after) {
    const position = before.findIndex((old, index) => !used.has(index) &&
      (old.id && item.id ? old.id === item.id : legacyKey(old) === legacyKey(item)));
    if (position < 0) { added.push(item); continue; }
    used.add(position);
    const old = before[position];
    if (["date", "time", "name", "detail", "fixed"].some(field => old[field as keyof ItineraryItem] !== item[field as keyof ItineraryItem])) changed.push({ before: old, after: item });
    else retained.push(item);
  }
  return { added, removed: before.filter((_, index) => !used.has(index)), retained, changed };
}
