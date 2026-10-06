import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule, plain } from "./test-support/module-loader.mjs";

const { applyWhoopResponse, EMPTY_WHOOP_DISPLAY, readWhoopResponse, whoopMetricLabel, whoopReadFailed, whoopStatusLabel } = loadModule("lib/whoop-display.ts");
const empty = { recoveryScore: null, hrvRmssdMilli: null, restingHeartRate: null, sleepMinutes: null, sleepPerformance: null, cycleStrain: null, cycleSteps: null, measuredAt: null };
const firstRead = "2026-10-03T01:00:00.000Z";
const secondRead = "2026-10-03T02:00:00.000Z";
const readings = { ...empty, recoveryScore: 82, hrvRmssdMilli: 65, restingHeartRate: 52, sleepMinutes: 450, sleepPerformance: 90, cycleStrain: 8, measuredAt: "2026-10-02T23:30:00Z" };
const saved = applyWhoopResponse(EMPTY_WHOOP_DISPLAY, { connected: true, summary: readings, syncStatus: "synced", retrievedAt: firstRead }, true);

test("stored authorisation and an all-null successful response do not claim data was synced", () => {
  const authorised = { ...EMPTY_WHOOP_DISPLAY, connected: true, status: "connected" };
  assert.equal(whoopStatusLabel(authorised.status), "授权已保存");
  const result = applyWhoopResponse(authorised, { connected: true, summary: empty, syncStatus: "empty", retrievedAt: firstRead }, true);
  assert.equal(result.status, "empty");
  assert.equal(result.connected, true);
  assert.equal(whoopMetricLabel(result, null, "recoveryScore"), "近期暂无此项记录");
  assert.notEqual(whoopStatusLabel(result.status), "读取成功");
});

test("HTTP failure preserves last successful readings and the actual read timestamp", () => {
  const result = applyWhoopResponse(saved, { connected: true, summary: null, syncStatus: "failed", error: "WHOOP 暂时读取失败。" }, false);
  assert.deepEqual(plain(result.summary), readings);
  assert.equal(result.retrievedAt, firstRead);
  assert.equal(result.status, "failed");
  assert.equal(result.connected, true);
  assert.equal(whoopMetricLabel(result, result.summary.recoveryScore, "recoveryScore"), "上次成功读数");
  assert.equal(whoopMetricLabel(result, result.summary.cycleSteps, "cycleSteps"), "本次未读取到");
});

test("network failure retains authorisation and good readings", () => {
  const result = whoopReadFailed(saved);
  assert.equal(result.status, "failed");
  assert.equal(result.connected, true);
  assert.deepEqual(plain(result.summary), readings);
  assert.equal(result.retrievedAt, firstRead);
});

test("HTTP409 flags survive response parsing and require a new authorisation", async () => {
  const response = new Response(JSON.stringify({ connected: false, reauthorizationRequired: true, syncStatus: "reauthorization_required", error: "授权已失效。", summary: null }), { status: 409 });
  const payload = await readWhoopResponse(response);
  const result = applyWhoopResponse(saved, payload, response.ok);
  assert.equal(result.connected, false);
  assert.equal(result.status, "reauthorization_required");
  assert.equal(result.summary, null);
  assert.equal(result.retrievedAt, null);
  assert.equal(whoopMetricLabel(result, null, "recoveryScore"), "重新授权后可读取");
});

test("partial reads merge only failed domains and label old and new values separately", () => {
  const result = applyWhoopResponse(saved, { connected: true, summary: { ...empty, sleepMinutes: 420, sleepPerformance: 85, cycleStrain: 6 }, syncStatus: "partial", failedMetrics: ["recovery"], retrievedAt: secondRead, error: "恢复数据暂时不可用。" }, true);
  assert.equal(result.status, "partial");
  assert.equal(result.summary.recoveryScore, 82);
  assert.equal(result.summary.sleepMinutes, 420);
  assert.equal(result.summary.cycleStrain, 6);
  assert.equal(result.retrievedAt, secondRead);
  assert.deepEqual(plain(result.retainedFields), ["recoveryScore", "hrvRmssdMilli", "restingHeartRate"]);
  assert.equal(whoopMetricLabel(result, result.summary.recoveryScore, "recoveryScore"), "上次成功读数");
  assert.equal(whoopMetricLabel(result, result.summary.sleepMinutes, "sleepMinutes"), "WHOOP 最近记录");
});

test("a failed sleep read does not erase previous sleep or label new recovery as old", () => {
  const result = applyWhoopResponse(saved, { connected: true, summary: { ...empty, recoveryScore: 70 }, syncStatus: "partial", failedMetrics: ["sleep"], retrievedAt: secondRead }, true);
  assert.equal(result.summary.sleepMinutes, 450);
  assert.equal(result.summary.recoveryScore, 70);
  assert.equal(result.summary.cycleStrain, null, "An empty successful domain is not backfilled as if it failed");
  assert.equal(whoopMetricLabel(result, result.summary.recoveryScore, "recoveryScore"), "WHOOP 最近记录");
  assert.equal(whoopMetricLabel(result, result.summary.sleepMinutes, "sleepMinutes"), "上次成功读数");
});

test("pending scoring is reported without inventing a recovery score", () => {
  const result = applyWhoopResponse(EMPTY_WHOOP_DISPLAY, { connected: true, summary: { ...empty, scoreState: "PENDING_SCORE" }, syncStatus: "empty", retrievedAt: firstRead }, true);
  assert.equal(result.status, "empty");
  assert.equal(result.summary.recoveryScore, null);
  assert.match(result.message, /仍在计算评分/);
  assert.equal(whoopMetricLabel(result, null, "recoveryScore"), "等待 WHOOP 评分");
  assert.equal(whoopMetricLabel(result, null, "cycleSteps"), "近期暂无此项记录");
});

test("an empty later read keeps old readings clearly marked with their original timestamp", () => {
  const result = applyWhoopResponse(saved, { connected: true, summary: empty, syncStatus: "empty", retrievedAt: secondRead }, true);
  assert.equal(result.status, "empty");
  assert.deepEqual(plain(result.summary), readings);
  assert.equal(result.retrievedAt, firstRead);
  assert.equal(whoopMetricLabel(result, result.summary.sleepMinutes, "sleepMinutes"), "上次成功读数");
});

test("zero is a real reading and no retrieval timestamp is fabricated", () => {
  const result = applyWhoopResponse(EMPTY_WHOOP_DISPLAY, { connected: true, summary: { ...empty, cycleStrain: 0, measuredAt: firstRead } }, true);
  assert.equal(result.status, "synced");
  assert.equal(result.summary.cycleStrain, 0);
  assert.equal(result.retrievedAt, null);
});

test("malformed responses become retryable failures and keep prior good data", async () => {
  const payload = await readWhoopResponse(new Response("not-json"));
  const result = applyWhoopResponse(saved, payload, true);
  assert.equal(result.status, "failed");
  assert.deepEqual(plain(result.summary), readings);
});
