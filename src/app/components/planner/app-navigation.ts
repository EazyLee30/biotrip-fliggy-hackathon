export const APP_VIEWS = ["today", "itinerary", "explore", "profile", "body", "create", "breathing", "sleep", "fatigue", "replan", "adjust-day", "collections", "plan-preview"] as const;
export type AppView = typeof APP_VIEWS[number];
export type NavigationIntent = "open" | "tab" | "back" | "replace";
export type AppNavigation = {
  view: AppView;
  scrolls: Partial<Record<AppView, number>>;
  parents: Array<{ view: AppView; scroll: number }>;
};
export const initialNavigation = (): AppNavigation => ({ view: "today", scrolls: {}, parents: [] });
const SUBVIEWS: readonly AppView[] = ["body", "sleep", "fatigue", "breathing", "create", "replan", "adjust-day", "collections", "plan-preview"];

function fallbackParent(view: AppView): AppView {
  if (["sleep", "fatigue", "breathing"].includes(view)) return "body";
  if (["replan", "adjust-day", "collections", "plan-preview"].includes(view)) return "itinerary";
  return "today";
}

/** Content links open at the top; tabs remember their position; back restores the actual parent. */
export function transitionNavigation(state: AppNavigation, next: AppView, intent: NavigationIntent, scroll: number): { state: AppNavigation; top: number } {
  const scrolls = { ...state.scrolls, [state.view]: Math.max(0, scroll) };
  if (intent === "back") {
    const parent = state.parents.at(-1) ?? { view: fallbackParent(state.view), scroll: 0 };
    return { state: { view: parent.view, scrolls, parents: state.parents.slice(0, -1) }, top: parent.scroll };
  }
  const parents = intent === "open" && next !== state.view && SUBVIEWS.includes(next)
    ? [...state.parents, { view: state.view, scroll: Math.max(0, scroll) }]
    : intent === "open" && next === state.view ? state.parents : [];
  return { state: { view: next, scrolls, parents }, top: intent === "tab" && next !== state.view ? scrolls[next] ?? 0 : 0 };
}

function validView(value: string): value is AppView {
  return (APP_VIEWS as readonly string[]).includes(value);
}

/** View fragments stay in this document and are never sent to the server. */
export function readAppView(search: string, hash: string): AppView {
  const fragment = hash.replace(/^#/, "");
  if (fragment === "adjust") return "itinerary";
  if (validView(fragment)) return fragment;
  const legacy = new URLSearchParams(search).get("view") ?? "";
  if (legacy === "adjust") return "itinerary";
  return validView(legacy) ? legacy : "today";
}

export function appViewUrl(search: string, view: AppView): string {
  const params = new URLSearchParams(search);
  params.delete("view");
  const query = params.toString();
  return `/app${query ? `?${query}` : ""}#${view}`;
}

export function appJourneyUrl(search: string, hash: string, id: string | null): string {
  const params = new URLSearchParams(search);
  if (id) params.set("journey", id); else params.delete("journey");
  return appViewUrl(params.toString(), readAppView(search, hash));
}
