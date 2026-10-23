import type { MemoryItem } from "./memory-types";
/** Keep scoped, recent facts useful as memory grows, without unbounded prompts. */
export function boundedMemoryContext(
  items: MemoryItem[],
  maximumChars = 5000,
  maximumItems = 16,
) {
  const priority = (item: MemoryItem) =>
    (item.scope === "day" ? 0 : item.scope === "journey" ? 1 : 2) * 10 +
    (item.source === "manual" ? 0 : item.source === "chat" ? 1 : 2);
  const candidates = [...items].sort(
    (a, b) =>
      priority(a) - priority(b) || b.updatedAt.localeCompare(a.updatedAt),
  );
  const selected: MemoryItem[] = [];
  let remaining = maximumChars;
  for (const item of candidates) {
    if (selected.length >= maximumItems || remaining <= 0) break;
    const note = item.note.slice(0, Math.min(700, remaining));
    selected.push({ ...item, note });
    remaining -= note.length;
  }
  return selected;
}
