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
          properties: { date: string, time: string, name: string, detail: string, fixed: { type: "boolean" } },
          required: ["date", "time", "name", "detail", "fixed"],
        },
      },
      places: {
        type: "array", maxItems: Math.min(8, sourceCount),
        items: {
          type: "object", additionalProperties: false,
          properties: { source_index: { type: "integer", minimum: 0, maximum: Math.max(0, sourceCount - 1) }, reason: string },
          required: ["source_index", "reason"],
        },
      },
    },
    required: ["headline", "summary", "reason", "adjustments", "itinerary", "places"],
  };
}
