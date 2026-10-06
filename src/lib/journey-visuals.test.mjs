import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { loadModule, readProjectFile } from "./test-support/module-loader.mjs";
import { bindVisuals } from "./planning/visuals.ts";

const account = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222";
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of ["0001_accounts", "0002_password_auth", "0003_journeys", "0007_planning_jobs", "0008_adjustments"]) sqlite.exec(readProjectFile(`migrations/${name}.sql`));
  sqlite.prepare("INSERT INTO accounts(id,email) VALUES(?,?)").run(account, "qa@example.invalid");
  const draft = JSON.stringify({ trip: { destinationCity: "杭州" } });
  const plan = JSON.stringify({ source: "live", plan: { itinerary: [{ id: "walk", name: "西湖晨间散步", date: "2026-10-12", time: "10:00", fixed: true, detail: "散步", kind: "sight" }], places: [] }, localServices: [] });
  sqlite.prepare("INSERT INTO journeys(id,account_id,title,status,draft_json,plan_json,plan_draft_json) VALUES(?,?,?,'planned',?,?,?)").run(id, account, "杭州", draft, plan, draft);
  const db = { prepare(sql) { const statement = sqlite.prepare(sql); let args = []; return { bind(...values) { args = values; return this; }, async first() { return statement.get(...args) ?? null; }, async run() { return statement.run(...args); } }; } };
  const journeys = loadModule("lib/journeys.ts", {
    "@/lib/database": { getDatabase: () => db }, "@/lib/preferences": {}, "@/lib/itinerary-edit": loadModule("lib/itinerary-edit.ts", { "./planner-input": loadModule("lib/planner-input.ts") }),
  });
  let calls = 0, concurrent = false;
  const api = loadModule("lib/journey-visuals.ts", {
    "./database": { getDatabase: () => db }, "./journeys": journeys, "./planning/visuals": { bindVisuals },
    "./destination-visuals": { destinationVisuals: async () => {
      calls++;
      if (concurrent) sqlite.prepare("UPDATE journeys SET version=version+1,title='同时编辑' WHERE id=?").run(id);
      return { city: "杭州", sources: [{ name: "杭州西湖风景名胜区", url: "https://a.feizhu.com/poi/1", category: "景点", imageUrl: "https://img.alicdn.com/westlake.jpg" }] };
    } },
  });
  return { sqlite, journeys, calls: () => calls, concurrent: () => { concurrent = true; }, run: (version = 1, owner = account) => api.supplementJourneyVisuals(owner, id, { version }, new AbortController().signal) };
}
test("supplement preserves reservations and draft, adds real pictures, and creates a restorable version", async () => {
  const f = fixture(); try {
    const before = f.sqlite.prepare("SELECT * FROM journeys").get();
    const result = await f.run(); assert.equal(result.updated, true); assert.equal(result.journey.version, 2);
    const after = f.sqlite.prepare("SELECT * FROM journeys").get();
    assert.equal(after.draft_json, before.draft_json); assert.equal(after.plan_draft_json, before.plan_draft_json);
    const item = result.journey.plan.plan.itinerary[0]; assert.equal(item.fixed, true); assert.equal(item.time, "10:00");
    assert.equal(item.sourceUrl, "https://a.feizhu.com/poi/1"); assert.equal(result.journey.plan.visuals.cover[0].kind, "poi");
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM journey_versions WHERE version=1").get().n, 1);
    const again = await f.run(2); assert.equal(again.updated, false); assert.equal(again.journey.version, 2);
  } finally { f.sqlite.close(); }
});
test("ownership and stale version reject before retrieval; concurrent edits win the conditional save", async () => {
  const f = fixture(); try {
    await assert.rejects(f.run(2), error => error.status === 409); assert.equal(f.calls(), 0);
    await assert.rejects(f.run(1, "33333333-3333-4333-8333-333333333333"), error => error.status === 404); assert.equal(f.calls(), 0);
    f.concurrent(); await assert.rejects(f.run(), error => error.status === 409);
    assert.equal(f.sqlite.prepare("SELECT title FROM journeys").get().title, "同时编辑");
    assert.equal(JSON.parse(f.sqlite.prepare("SELECT plan_json FROM journeys").get().plan_json).visuals, undefined);
  } finally { f.sqlite.close(); }
});
