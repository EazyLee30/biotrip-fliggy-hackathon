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
  let url = new URL("https://biotrip.eazylee.si/?view=create&journey=trip-1&whoop=connected");
  for (let round = 0; round < 20; round++) {
    for (const view of ["profile", "itinerary", "today", "explore"]) {
      url = new URL(appViewUrl(url.search, view), url.origin);
      assert.equal(url.pathname, "/app");
      assert.equal(url.searchParams.has("view"), false);
      assert.equal(url.searchParams.get("journey"), "trip-1");
      assert.equal(url.searchParams.get("whoop"), "connected");
      assert.equal(readAppView(url.search, url.hash), view);
    }
  }
});

test("saving and clearing a journey preserve the open view", () => {
  assert.equal(appJourneyUrl("?view=profile", "", "new-trip"), "/app?journey=new-trip#profile");
  assert.equal(appJourneyUrl("?journey=old-trip", "#adjust", "new-trip"), "/app?journey=new-trip#itinerary");
  assert.equal(appJourneyUrl("?journey=old-trip", "#create", null), "/app#create");
});

test("detail back restores its actual parent and scroll, including nested breathing", () => {
  let nav = transitionNavigation(initialNavigation(), "itinerary", "tab", 0).state;
  nav = transitionNavigation(nav, "fatigue", "open", 700).state;
  nav = transitionNavigation(nav, "breathing", "open", 250).state;
  const first = transitionNavigation(nav, "today", "back", 0);
  assert.equal(first.state.view, "fatigue"); assert.equal(first.top, 250);
  const second = transitionNavigation(first.state, "today", "back", 250);
  assert.equal(second.state.view, "itinerary"); assert.equal(second.top, 700);
});

test("profile content link resets itinerary scroll while dock tab switching preserves it", () => {
  let nav = transitionNavigation(initialNavigation(), "itinerary", "tab", 0).state;
  nav = transitionNavigation(nav, "profile", "tab", 1800).state;
  const tab = transitionNavigation(nav, "itinerary", "tab", 500);
  assert.equal(tab.top, 1800);
  const link = transitionNavigation(nav, "itinerary", "open", 500);
  assert.equal(link.top, 0); assert.deepEqual(link.state.parents, []);
  assert.equal(transitionNavigation(tab.state, "itinerary", "tab", 1800).top, 0);
});

test("sleep has a sensible parent on direct entry and abandoned details do not pollute later back", () => {
  const direct = transitionNavigation(initialNavigation(), "sleep", "replace", 0).state;
  assert.equal(transitionNavigation(direct, "today", "back", 0).state.view, "body");
  let nav = transitionNavigation(initialNavigation(), "sleep", "open", 100).state;
  nav = transitionNavigation(nav, "profile", "tab", 500).state;
  nav = transitionNavigation(nav, "sleep", "open", 300).state;
  const back = transitionNavigation(nav, "today", "back", 0);
  assert.equal(back.state.view, "profile"); assert.equal(back.top, 300);
});

test("adjustment flows return to the itinerary and retain their nested parent", () => {
  for (const view of ["replan", "adjust-day"]) {
    let nav = transitionNavigation(initialNavigation(), "itinerary", "tab", 0).state;
    nav = transitionNavigation(nav, view, "open", 240).state;
    nav = transitionNavigation(nav, "breathing", "open", 120).state;
    const nested = transitionNavigation(nav, "today", "back", 0);
    assert.equal(nested.state.view, view);
    assert.equal(nested.top, 120);
    const back = transitionNavigation(nested.state, "today", "back", 120);
    assert.equal(back.state.view, "itinerary");
    assert.equal(back.top, 240);
  }
});


test("direct detail entries return to their owning destination", () => {
  for (const [view, parent] of [["body", "today"], ["itinerary", "today"], ["collections", "itinerary"], ["replan", "itinerary"], ["adjust-day", "itinerary"], ["sleep", "body"], ["breathing", "body"]]) {
    const nav = transitionNavigation(initialNavigation(), view, "replace", 0).state;
    assert.equal(transitionNavigation(nav, "today", "back", 0).state.view, parent);
  }
});

test("old adjustment links resolve to the first-class itinerary", () => {
  assert.equal(readAppView("", "#adjust"), "itinerary");
  assert.equal(readAppView("?view=adjust", ""), "itinerary");
  assert.equal(appJourneyUrl("?view=adjust&journey=old", "", "new"), "/app?journey=new#itinerary");
});

test("body records return to their actual source, and a tab leaves the detail stack", () => {
  for (const parent of ["today", "profile"]) {
    let nav = transitionNavigation(initialNavigation(), parent, "tab", 0).state;
    nav = transitionNavigation(nav, "body", "open", 380).state;
    nav = transitionNavigation(nav, "sleep", "open", 180).state;
    const toBody = transitionNavigation(nav, "today", "back", 0);
    assert.equal(toBody.state.view, "body");
    assert.equal(toBody.top, 180);
    const toSource = transitionNavigation(toBody.state, "today", "back", 180);
    assert.equal(toSource.state.view, parent);
    assert.equal(toSource.top, 380);
    const tab = transitionNavigation(nav, "itinerary", "tab", 0);
    assert.deepEqual(tab.state.parents, []);
  }
});

test("quick adjustment from today returns to today with its scroll", () => {
  const nav = transitionNavigation(initialNavigation(), "adjust-day", "open", 420).state;
  const back = transitionNavigation(nav, "today", "back", 0);
  assert.equal(back.state.view, "today");
  assert.equal(back.top, 420);
});
