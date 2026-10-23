import type { AssistantBlock } from "./types";
const text = (value: unknown, limit: number) => typeof value === "string" ? value.trim().slice(0, limit) : "";
/** Only bounded questions can originate with the model. Source and collection
 * cards are built from authenticated tool results by the server. */
export function questionBlocks(raw: unknown): AssistantBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 2).flatMap((item, index): AssistantBlock[] => {
    if (!item || typeof item !== "object" || item.type !== "question") return [];
    const title = text(item.title, 160);
    if (!title) return [];
    if (item.input === "date") return [{ type: "question", id: `question-${index}`, title, input: "date", ...(/^\d{4}-\d{2}-\d{2}$/.test(item.min) ? { min: item.min } : {}) }];
    if (item.input !== "options" || !Array.isArray(item.options)) return [];
    const options = item.options.slice(0, 5).flatMap((option: unknown) => {
      if (!option || typeof option !== "object") return [];
      const candidate = option as Record<string, unknown>, label = text(candidate.label, 40), value = text(candidate.value, 240);
      return label && value ? [{ label, value }] : [];
    });
    return options.length ? [{ type: "question", id: `question-${index}`, title, input: "options", options }] : [];
  });
}

export function memoryAllowed(globalSetting: boolean, messageSetting: unknown) {
  return globalSetting && messageSetting !== false;
}
