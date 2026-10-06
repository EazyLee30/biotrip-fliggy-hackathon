function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Only bind recognised fields actually declared by tools/list. Unsupported schemas fail closed. */
export function poiArguments(tool: unknown, city: string): Record<string, unknown> {
  if (!record(tool) || tool.name !== "search_poi" || !record(tool.inputSchema)) throw new Error("FLYAI_POI_SCHEMA_UNSUPPORTED");
  const schema = tool.inputSchema;
  if (schema.type !== "object" || !record(schema.properties) || schema.oneOf || schema.anyOf || schema.allOf) throw new Error("FLYAI_POI_SCHEMA_UNSUPPORTED");
  const args: Record<string, unknown> = {};
  let location = false;
  for (const [name, field] of Object.entries(schema.properties)) {
    if (!record(field)) continue;
    if (["city", "cityName", "city_name", "keyword", "query", "keywords"].includes(name) && field.type === "string") {
      // A declared enum may require a provider-specific city ID; never substitute a name for it.
      if (Array.isArray(field.enum) && !field.enum.includes(city)) throw new Error("FLYAI_POI_SCHEMA_UNSUPPORTED");
      args[name] = city;
      location = true;
    }
  }
  if (!location) throw new Error("FLYAI_POI_SCHEMA_UNSUPPORTED");
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const name of required) {
    if (typeof name !== "string") throw new Error("FLYAI_POI_SCHEMA_UNSUPPORTED");
    // Do not infer city IDs, coordinates, categories or required pagination values.
    if (!(name in args)) throw new Error("FLYAI_POI_SCHEMA_UNSUPPORTED");
  }
  return args;
}
