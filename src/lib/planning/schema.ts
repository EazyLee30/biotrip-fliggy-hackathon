/** Strict output schema for the composing stage, shared by both providers. */
export function composedPlanSchema(sourceCount: number) {
  const string = { type: "string" };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      headline: string,
      summary: string,
      reason: string,
      adjustments: { type: "array", items: string, maxItems: 8 },
      itinerary: {
        type: "array", minItems: 1, maxItems: 100,
        items: {
          type: "object", additionalProperties: false,
          properties: { date: string, time: string, name: string, detail: string, fixed: { type: "boolean" },
            kind: { type: "string", enum: ["sight", "meal", "rest", "relax", "stay", "experience", "transit", "other"] },
            effort: { type: "integer", enum: [1, 2, 3] }, duration_min: { type: "integer", minimum: 5, maximum: 600 },
            move_mode: { type: "string", enum: ["walk", "transit", "taxi", "none"] } },
          required: ["date", "time", "name", "detail", "fixed"],
        },
      },
      places: {
        type: "array", maxItems: Math.min(8, sourceCount),
        items: {
          type: "object", additionalProperties: false,
          properties: { source_index: { type: "integer", minimum: 0, maximum: Math.max(0, sourceCount - 1) }, source_name: string, reason: string },
          required: ["source_index", "source_name", "reason"],
        },
      },
    },
    required: ["headline", "summary", "reason", "adjustments", "itinerary", "places"],
  };
}
