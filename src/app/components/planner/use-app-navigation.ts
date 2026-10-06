"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { appViewUrl, initialNavigation, readAppView, transitionNavigation, type AppView, type NavigationIntent, type AppNavigation } from "./app-navigation";

/** Navigation owns scroll restoration; callers retain save-before-leaving guards. */
export function useAppNavigation(onNavigate: () => void) {
  const [view, setView] = useState<AppView>("today");
  const [profileVisited, setProfileVisited] = useState(false);
  const navigation = useRef(initialNavigation());
  const depth = useRef(0);
  const pendingScroll = useRef<number | null>(null);
  const [epoch, setEpoch] = useState(0);
  const resetScroll = useCallback(() => {
    pendingScroll.current = 0;
    setEpoch((value) => value + 1);
  }, []);
  const navigateNow = useCallback((next: AppView, intent: NavigationIntent = "replace") => {
    if (intent === "back" && depth.current > 0) { window.history.back(); return; }
    const before = navigation.current;
    const result = transitionNavigation(navigation.current, next, intent, window.scrollY);
    navigation.current = result.state;
    pendingScroll.current = result.top;
    if (result.state.view === "profile") setProfileVisited(true);
    setView(result.state.view);
    setEpoch((value) => value + 1);
    onNavigate();
    const push = (intent === "open" || intent === "tab") && result.state.view !== before.view;
    if (push) {
      window.history.replaceState({ ...window.history.state, biotripNavigation: { depth: depth.current, state: { ...before, scrolls: { ...before.scrolls, [before.view]: window.scrollY } }, top: window.scrollY } }, "");
      depth.current += 1;
    }
    const entry = { ...window.history.state, biotripNavigation: { depth: depth.current, state: result.state, top: result.top } };
    window.history[push ? "pushState" : "replaceState"](entry, "", appViewUrl(window.location.search, result.state.view));
  }, [onNavigate]);
  useLayoutEffect(() => {
    if (pendingScroll.current === null) return;
    // Restore only after the destination DOM commits.
    window.scrollTo({ top: pendingScroll.current, behavior: "instant" });
    pendingScroll.current = null;
  }, [view, epoch]);
  useEffect(() => {
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    const listener = () => {
      const next = readAppView(window.location.search, window.location.hash);
      const entry = window.history.state?.biotripNavigation as { depth: number; state: AppNavigation; top: number } | undefined;
      if (!entry || entry.state?.view !== next || !Number.isFinite(entry.top)) { navigateNow(next); return; }
      depth.current = entry.depth;
      navigation.current = entry.state;
      pendingScroll.current = entry.top;
      if (next === "profile") setProfileVisited(true);
      setView(next); setEpoch(value => value + 1); onNavigate();
    };
    window.addEventListener("popstate", listener);
    window.addEventListener("hashchange", listener);
    return () => {
      window.history.scrollRestoration = previousRestoration;
      window.removeEventListener("popstate", listener);
      window.removeEventListener("hashchange", listener);
    };
  }, [navigateNow, onNavigate]);
  return { view, profileVisited, navigateNow, resetScroll };
}
