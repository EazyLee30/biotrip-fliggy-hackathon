export const APP_VIEWS = ["today", "adjust", "explore", "profile", "create", "breathing", "sleep", "fatigue"] as const;
export type AppView = typeof APP_VIEWS[number];
export type NavigationIntent = "open" | "tab" | "back" | "replace";
export type AppNavigation = {
  view: AppView;
  scrolls: Partial<Record<AppView, number>>;
  parents: Array<{ view: AppView; scroll: number }>;
};
export const initialNavigation = (): AppNavigation => ({ view: "today", scrolls: {}, parents: [] });
const SUBVIEWS: readonly AppView[] = ["sleep", "fatigue", "breathing", "create"];

/** Content links open at the top; tabs remember their position; back restores the actual parent. */
export function transitionNavigation(state: AppNavigation, next: AppView, intent: NavigationIntent, scroll: number): { state: AppNavigation; top: number } {
  const scrolls = { ...state.scrolls, [state.view]: Math.max(0, scroll) };
  if (intent === "back") {
    const parent = state.parents.at(-1) ?? { view: state.view === "create" ? "today" as const : "adjust" as const, scroll: 0 };
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
  if (validView(fragment)) return fragment;
  const legacy = new URLSearchParams(search).get("view") ?? "";
  return validView(legacy) ? legacy : "today";
}

export function appViewUrl(search: string, view: AppView): string {
  const params = new URLSearchParams(search);
  params.delete("view");
  const query = params.toString();
  return `/${query ? `?${query}` : ""}#${view}`;
}

export function appJourneyUrl(search: string, hash: string, id: string | null): string {
  const params = new URLSearchParams(search);
  if (id) params.set("journey", id); else params.delete("journey");
  return appViewUrl(params.toString(), readAppView(search, hash));
}
