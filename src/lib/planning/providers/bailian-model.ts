import { readBoundedUpstream } from "@/lib/upstream-response";
import { parseJsonText, parsePlan, safeHttpsUrl } from "@/lib/bailian-output";
import { searchFlyai, type FlyaiSource } from "@/lib/flyai";
import { composePlanPrompt, healthInsightPrompt, localResearchPrompt } from "../prompts";
import { composedPlanSchema } from "../schema";
import {
  PlannerError,
  type ComposedPlan,
  type FlyaiInventory,
  type GatheredResults,
  type HealthBasis,
  type HealthInsight,
  type LocalResearch,
  type LocalService,
  type PlanningProvider,
  type StageContext,
} from "../contract";

export type ModelTransport = { apiKey: string; baseUrl: string; model: string };

// Token Plan explicitly excludes application backends. Never substitute a
// sk-sp key or its endpoint for the standard workspace model API.
export function getModelTransport(): ModelTransport | null {
  const apiKey = (process.env.BAILIAN_MODEL_API_KEY || process.env.BAILIAN_API_KEY || "").trim();
  const workspace = process.env.BAILIAN_WORKSPACE_ID?.trim();
  const region = process.env.BAILIAN_REGION || "cn-beijing";
  const model = process.env.BAILIAN_PLAN_MODEL || "qwen3.7-flash";
  if (!apiKey || apiKey.startsWith("sk-sp-") || !workspace || !/^[a-zA-Z0-9-]{1,100}$/.test(workspace) ||
    !/^[a-z0-9-]{1,40}$/.test(region) ||
    !/^qwen3\.(?:5|6|7|8)-(?:flash|plus|max)(?:-[a-zA-Z0-9-]+)?$/.test(model)) return null;
  return { apiKey, model, baseUrl: `https://${workspace}.${region}.maas.aliyuncs.com/compatible-mode/v1` };
}

export class ModelRequestError extends Error {
  constructor(readonly status: number, readonly code: string, readonly requestId: string | null = null) {
    super(code);
    this.name = "ModelRequestError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function safeCode(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value) ? value : null;
}

async function modelRequest(
  config: ModelTransport,
  endpoint: string,
  body: unknown,
  signal: AbortSignal,
  timeoutMs: number,
) {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), cache: "no-store", redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    });
  } catch (error) {
    signal.throwIfAborted();
    throw new ModelRequestError(
      504,
      error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
        ? "UPSTREAM_TIMEOUT" : "MODEL_CONNECTION_ERROR",
    );
  }
  const requestId = safeCode(response.headers.get("x-request-id") || response.headers.get("x-acs-request-id"));
  let value: unknown;
  try {
    value = JSON.parse(await readBoundedUpstream(response, 1_000_000));
  } catch (error) {
    signal.throwIfAborted();
    const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    throw new ModelRequestError(
      timeout ? 504 : 502,
      timeout ? "UPSTREAM_TIMEOUT"
        : error instanceof Error && error.message === "UPSTREAM_RESPONSE_TOO_LARGE" ? "MODEL_RESPONSE_TOO_LARGE"
        : "INVALID_MODEL_RESPONSE",
      requestId,
    );
  }
  if (!response.ok) {
    const error = record(value) && record(value.error) ? value.error : value;
    throw new ModelRequestError(
      response.status,
      record(error) ? safeCode(error.code) || "MODEL_HTTP_ERROR" : "MODEL_HTTP_ERROR",
      requestId,
    );
  }
  if (!record(value)) throw new ModelRequestError(502, "INVALID_MODEL_RESPONSE", requestId);
  return { value, requestId };
}

function parseLocalServices(text: string, sourceUrls: string[]): LocalService[] {
  const parsed = parseJsonText(text);
  if (!Array.isArray(parsed.services)) {
    throw new ModelRequestError(502, "INVALID_LOCAL_INFORMATION");
  }
  const verified = new Set(sourceUrls);
  return parsed.services.filter(record).slice(0, 6).map((item) => {
    const sourceUrl = safeHttpsUrl(item.source_url);
    // A source URL the search tool never returned is a fabrication, not a result.
    if (!sourceUrl || !verified.has(sourceUrl) || typeof item.name !== "string" ||
      typeof item.kind !== "string" || typeof item.detail !== "string" || typeof item.source !== "string") return null;
    return {
      name: item.name.slice(0, 180), kind: item.kind.slice(0, 80),
      detail: item.detail.slice(0, 500), source: item.source.slice(0, 160), sourceUrl,
    };
  }).filter((item): item is LocalService => item !== null);
}

/**
 * Plain Bailian model API provider. Cheaper and faster than Managed Agents and
 * used as the fallback transport; the competition's required Managed Agents
 * path lives in `bailian-agent.ts` behind the same interface.
 */
export function createModelProvider(transport: ModelTransport): PlanningProvider {
  const chat = async (instructions: string, input: unknown, signal: AbortSignal, timeoutMs = 45_000) => {
    const { value, requestId } = await modelRequest(transport, "chat/completions", {
      model: transport.model, reasoning_effort: "none", enable_thinking: false,
      messages: [{ role: "system", content: instructions }, { role: "user", content: JSON.stringify(input) }],
      response_format: /^qwen3\.(?:7|8)-/.test(transport.model)
        ? { type: "json_schema", json_schema: { name: "biotrip_plan", strict: true, schema: composedPlanSchema(1) } }
        : { type: "json_object" },
    }, signal, timeoutMs);
    const choice = (Array.isArray(value.choices) ? value.choices.filter(record) : [])[0];
    const message = choice && record(choice.message) ? choice.message : null;
    if (choice?.finish_reason !== "stop" || !message || typeof message.content !== "string" || !message.content.trim()) {
      throw new ModelRequestError(502, "INCOMPLETE_MODEL_RESPONSE", requestId);
    }
    return message.content;
  };

  return {
    id: "model_api",
    assertConfigured() { if (!transport.apiKey) throw new Error("Model API is not configured."); },

    async healthInsight(ctx: StageContext): Promise<HealthInsight> {
      const text = await chat(healthInsightPrompt(ctx), {}, ctx.signal, 35_000);
      const parsed = parseJsonText(text);
      const pace = parsed.walking_pace;
      const breaks = parsed.break_frequency;
      if (!(typeof pace === "string" && ["reduced", "usual", "flexible"].includes(pace)) ||
          !(typeof breaks === "string" && ["frequent", "usual", "optional"].includes(breaks))) {
        throw new ModelRequestError(502, "INVALID_HEALTH_INSIGHT");
      }
      return {
        walkingPace: pace as HealthInsight["walkingPace"],
        breakFrequency: breaks as HealthInsight["breakFrequency"],
        sensoryFilters: Array.isArray(parsed.sensory_filters)
          ? parsed.sensory_filters.filter((item): item is string => typeof item === "string").slice(0, 5)
          : (ctx.input.preferences?.ambientPreferences ?? []),
        basis: (ctx.input.healthMetrics ? "whoop_recent" : selfReportBasis(ctx)) as HealthBasis,
        whoopUnavailable: false,
      };
    },

    async localResearch(ctx: StageContext): Promise<LocalResearch> {
      // The same instruction both transports use, so "what local research
      // means" has a single definition regardless of transport.
      const { value, requestId } = await modelRequest(transport, "responses", {
        model: transport.model, store: false, max_output_tokens: 2200, reasoning: { effort: "none" },
        tools: [{ type: "web_search" }], tool_choice: "required",
        instructions: localResearchPrompt(ctx),
        input: JSON.stringify({
          city: ctx.input.trip?.destinationCity,
          arrival_date: ctx.timing.arrivalDate,
          return_date: ctx.input.trip?.returnDate || null,
          requested_services: (ctx.input.trip?.requestedServices ?? []).filter((item) =>
            ["local_food", "relaxation", "onsen", "massage", "medical_info"].includes(item)),
          food_preferences: ctx.input.trip?.foodPreferences || null,
        }),
      }, ctx.signal, 35_000);
      if (value.status !== "completed" || !Array.isArray(value.output)) {
        throw new ModelRequestError(502, "INCOMPLETE_LOCAL_SEARCH", requestId);
      }
      const sources = new Set<string>();
      let text = "";
      let searches = 0;
      for (const item of value.output.filter(record)) {
        if (item.type === "web_search_call" && item.status === "completed") {
          searches += 1;
          for (const source of (record(item.action) && Array.isArray(item.action.sources) ? item.action.sources : []).filter(record)) {
            const url = safeHttpsUrl(source.url);
            if (url) sources.add(url);
          }
        }
        if (item.type === "message" && item.role === "assistant" && Array.isArray(item.content)) {
          text = item.content.filter(record)
            .filter((part) => part.type === "output_text" && typeof part.text === "string")
            .map((part) => part.text).join("");
        }
      }
      // No completed search means nothing was verified, so the stage degrades
      // rather than presenting model recall as a source.
      if (!searches || !text) throw new ModelRequestError(502, "NO_VERIFIED_WEB_SEARCH", requestId);
      return { services: parseLocalServices(text, [...sources]), searches };
    },

    /**
     * FlyAI is called directly by the Worker rather than through an agent, so
     * the search signature never depends on a Vault placeholder.
     */
    async flyaiInventory(ctx: StageContext): Promise<FlyaiInventory> {
      return flyaiInventory(ctx.signal, ctx.input.trip!, ctx.timing.arrivalDate);
    },

    async composePlan(ctx: StageContext, gathered: GatheredResults): Promise<ComposedPlan> {
      const { value, requestId } = await modelRequest(transport, "chat/completions", {
        model: transport.model, reasoning_effort: "none", enable_thinking: false,
        max_completion_tokens: Math.min(7200, 2000 + ctx.timing.days * 500),
        messages: [
          { role: "system", content: composePlanPrompt(ctx, gathered) },
          { role: "user", content: "{}" },
        ],
        response_format: /^qwen3\.(?:7|8)-/.test(transport.model)
          ? { type: "json_schema", json_schema: { name: "biotrip_plan", strict: true, schema: composedPlanSchema(gathered.inventory.sources.length) } }
          : { type: "json_object" },
      }, ctx.signal, 45_000);
      const choice = (Array.isArray(value.choices) ? value.choices.filter(record) : [])[0];
      const message = choice && record(choice.message) ? choice.message : null;
      if (choice?.finish_reason !== "stop" || !message || typeof message.content !== "string" || !message.content.trim()) {
        throw new ModelRequestError(502, "INCOMPLETE_TRAVEL_PLAN", requestId);
      }
      const plan = parsePlan(message.content, ctx.fixedItems);
      return { ...plan, places: bindPlaces(message.content, gathered.inventory.sources, requestId) };
    },
  };
}

function selfReportBasis(ctx: StageContext): HealthBasis {
  return ctx.isNearOrOngoingTrip && (ctx.input.selfReport?.fatigue != null || ctx.input.selfReport?.subjectiveStress != null)
    ? "self_report" : "preferences_only";
}

/**
 * Binds each place to a real retrieved source. Runs on the raw model output
 * because `parsePlan` normalises places and drops the model's `source_index`.
 */
export function bindPlaces(text: string, sources: FlyaiSource[], requestId: string | null = null): ComposedPlan["places"] {
  const parsed = parseJsonText(text);
  const body = record(parsed.plan) ? parsed.plan : parsed;
  if (!Array.isArray(body.places)) throw new ModelRequestError(502, "INVALID_TRAVEL_PLAN", requestId);
  return body.places.filter(record).map((place) => {
    const index = place.source_index;
    if (!Number.isInteger(index) || typeof place.reason !== "string") {
      throw new ModelRequestError(502, "INVALID_PLACE_REFERENCE", requestId);
    }
    const source = sources[index as number];
    // An index outside the retrieved set is a fabrication, not a recommendation.
    if (!source) throw new ModelRequestError(502, "UNVERIFIED_SOURCE_URL", requestId);
    return {
      name: source.name, category: source.category,
      source: "飞猪实时搜索", url: source.url,
      reason: place.reason.slice(0, 400),
    };
  }).slice(0, 8) as ComposedPlan["places"];
}

/**
 * FlyAI inventory shared by both providers. Categories are searched
 * individually so a combined keyword query cannot silently return only hotels
 * while the traveller believes every requested category was covered.
 */
export async function flyaiInventory(
  signal: AbortSignal,
  trip: StageContext["input"]["trip"] & object,
  arrivalDate: string,
): Promise<FlyaiInventory> {
  const services = trip.requestedServices;
  const searches: Promise<{ sources: FlyaiSource[] }>[] = [];
  const categories: string[] = [];
  const requests = [
    { key: "hotels", label: "酒店", category: "住宿" },
    { key: "attractions", label: "景点门票", category: "景点与体验" },
    { key: "travel_insurance", label: "旅游保险", category: "旅行服务" },
    { key: "transport", label: "当地交通 接送", category: "交通" },
  ].filter((service) => services.includes(service.key));
  for (const service of requests) {
    categories.push(service.category);
    searches.push(searchFlyai("fliggy_fast_search", { query: `${trip.destinationCity} ${arrivalDate} ${service.label}` }, signal, service.category));
  }
  if (services.includes("flights")) {
    categories.push("航班");
    searches.push(searchFlyai("search_flight", {
      origin: trip.originCity, destination: trip.destinationCity,
      depDate: trip.departureLocal.slice(0, 10),
      ...(trip.returnDate ? { backDate: trip.returnDate } : {}),
      limit: 5,
    }, signal, "航班"));
  }
  if (!searches.length) {
    categories.push("景点与体验");
    searches.push(searchFlyai("fliggy_fast_search", { query: `${trip.destinationCity} 景点门票` }, signal, "景点与体验"));
  }
  const results = await Promise.allSettled(searches);
  const successes = results.filter((result): result is PromiseFulfilledResult<{ sources: FlyaiSource[] }> => result.status === "fulfilled");
  if (!successes.length) {
    const failure = results.find((result) => result.status === "rejected");
    throw failure?.status === "rejected" ? failure.reason : new Error("NO_VERIFIED_FLYAI_SEARCH");
  }
  const sources = new Map<string, FlyaiSource>();
  for (const result of successes) {
    for (const source of result.value.sources) if (sources.size < 30) sources.set(source.url, source);
  }
  return {
    sources: [...sources.values()],
    searches: results.length,
    failedSearches: results.length - successes.length,
    failedCategories: results.flatMap((result, index) => result.status === "rejected" ? [categories[index]] : []),
  };
}

export { PlannerError };
