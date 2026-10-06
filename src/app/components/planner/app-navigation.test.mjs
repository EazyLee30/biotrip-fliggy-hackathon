import test from "node:test";
import assert from "node:assert/strict";
import { APP_VIEWS, appJourneyUrl, appViewUrl, readAppView, initialNavigation, transitionNavigation } from "./app-navigation.ts";

test("legacy deep links and fragments reopen every app view", () => {
  for (const view of APP_VIEWS) {
    assert.equal(readAppView(`?view=${view}`, ""), view);
    assert.equal(readAppView("", `#${view}`), view);
  }
  assert.equal(readAppView("?view=adjust", "#profile"), "profile");
  assert.equal(readAppView("?view=__proto__", "#unknown"), "today");
});

test("repeated tab switching uses fragments and preserves the selected journey", () => {
  let url = new URL("https://biotrip.ccwu.cc/?view=create&journey=trip-1&whoop=connected");
  for (let round = 0; round < 20; round++) {
    for (const view of ["profile", "adjust", "today", "explore"]) {
      url = new URL(appViewUrl(url.search, view), url.origin);
      assert.equal(url.pathname, "/");
      assert.equal(url.searchParams.has("view"), false);
      assert.equal(url.searchParams.get("journey"), "trip-1");
      assert.equal(url.searchParams.get("whoop"), "connected");
      assert.equal(readAppView(url.search, url.hash), view);
    }
  }
});

test("saving and clearing a journey preserve the open view", () => {
  assert.equal(appJourneyUrl("?view=profile", "", "new-trip"), "/?journey=new-trip#profile");
  assert.equal(appJourneyUrl("?journey=old-trip", "#adjust", "new-trip"), "/?journey=new-trip#adjust");
  assert.equal(appJourneyUrl("?journey=old-trip", "#create", null), "/#create");
});

test("detail back restores its actual parent and scroll, including nested breathing", () => {
  let nav = transitionNavigation(initialNavigation(), "adjust", "tab", 0).state;
  nav = transitionNavigation(nav, "fatigue", "open", 700).state;
  nav = transitionNavigation(nav, "breathing", "open", 250).state;
  const first = transitionNavigation(nav, "today", "back", 0);
  assert.equal(first.state.view, "fatigue"); assert.equal(first.top, 250);
  const second = transitionNavigation(first.state, "today", "back", 250);
  assert.equal(second.state.view, "adjust"); assert.equal(second.top, 700);
});

test("profile content link resets rhythm scroll while dock tab switching preserves it", () => {
  let nav = transitionNavigation(initialNavigation(), "adjust", "tab", 0).state;
  nav = transitionNavigation(nav, "profile", "tab", 1800).state;
  const tab = transitionNavigation(nav, "adjust", "tab", 500);
  assert.equal(tab.top, 1800);
  const link = transitionNavigation(nav, "adjust", "open", 500);
  assert.equal(link.top, 0); assert.deepEqual(link.state.parents, []);
  assert.equal(transitionNavigation(tab.state, "adjust", "tab", 1800).top, 0);
});

test("sleep has a sensible parent on direct entry and abandoned details do not pollute later back", () => {
  const direct = transitionNavigation(initialNavigation(), "sleep", "replace", 0).state;
  assert.equal(transitionNavigation(direct, "today", "back", 0).state.view, "adjust");
  let nav = transitionNavigation(initialNavigation(), "sleep", "open", 100).state;
  nav = transitionNavigation(nav, "profile", "tab", 500).state;
  nav = transitionNavigation(nav, "sleep", "open", 300).state;
  const back = transitionNavigation(nav, "today", "back", 0);
  assert.equal(back.state.view, "profile"); assert.equal(back.top, 300);
});
