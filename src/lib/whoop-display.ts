/** Browser-safe display state. Authorisation and a successful data read differ. */
export type WhoopSummary = {
  recoveryScore: number | null; hrvRmssdMilli: number | null; restingHeartRate: number | null;
  sleepMinutes: number | null; sleepPerformance: number | null; cycleStrain: number | null;
  cycleSteps: number | null; measuredAt: string | null; scoreState?: string; cycleScoreState?: string;
};
export type WhoopDisplayStatus = "checking" | "not_connected" | "connected" | "syncing" | "synced" | "partial" | "empty" | "failed" | "reauthorization_required";
export type WhoopDisplay = {
  connected: boolean; status: WhoopDisplayStatus; summary: WhoopSummary | null;
  retrievedAt: string | null; message: string; retained: boolean; retainedFields: string[];
};
export type WhoopSummaryResponse = {
  connected?: boolean; summary?: WhoopSummary | null; retrievedAt?: string | null;
  syncStatus?: string; reauthorizationRequired?: boolean; error?: string;
  failedMetrics?: Array<"recovery" | "sleep" | "cycle" | "workout" | "body_measurements">;
};
export const EMPTY_WHOOP_DISPLAY: WhoopDisplay = { connected: false, status: "checking", summary: null, retrievedAt: null, message: "", retained: false, retainedFields: [] };
const VALUE_KEYS = ["recoveryScore", "hrvRmssdMilli", "restingHeartRate", "sleepMinutes", "sleepPerformance", "cycleStrain", "cycleSteps"] as const;

function hasReadings(summary?: WhoopSummary | null) {
  return Boolean(summary && VALUE_KEYS.some((key) => typeof summary[key] === "number" && Number.isFinite(summary[key])));
}
function safeStamp(value?: string | null) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}
export function whoopReadFailed(current: WhoopDisplay, message = "WHOOP 数据暂时读取失败，请稍后重试。") {
  return { ...current, status: "failed" as const, message, retained: hasReadings(current.summary) };
}
export function applyWhoopResponse(current: WhoopDisplay, payload: WhoopSummaryResponse, ok: boolean): WhoopDisplay {
  if (payload.reauthorizationRequired || payload.syncStatus === "reauthorization_required") {
    return { ...EMPTY_WHOOP_DISPLAY, status: "reauthorization_required", message: "WHOOP 授权已失效，请重新授权。" };
  }
  if (payload.connected === false) return { ...EMPTY_WHOOP_DISPLAY, status: "not_connected", message: "尚未授权 WHOOP，可继续使用自己的感受规划。" };
  if (!ok || payload.syncStatus === "failed") return whoopReadFailed({ ...current, connected: payload.connected ?? current.connected }, payload.error || "WHOOP 数据暂时读取失败，请稍后重试。");
  const partial = payload.syncStatus === "partial";
  if (payload.error && !partial) return whoopReadFailed({ ...current, connected: payload.connected ?? current.connected }, payload.error);
  const summary = payload.summary ? { ...payload.summary } : null;
  const retainedFields: string[] = [];
  if (partial && summary && current.summary) {
    const groups = { recovery: ["recoveryScore", "hrvRmssdMilli", "restingHeartRate"], sleep: ["sleepMinutes", "sleepPerformance"], cycle: ["cycleStrain", "cycleSteps"] } as const;
    for (const group of ["recovery", "sleep", "cycle"] as const) {
      if (!payload.failedMetrics?.includes(group)) continue;
      for (const key of groups[group]) {
        if (summary[key] == null && current.summary[key] != null) { summary[key] = current.summary[key]; retainedFields.push(key); }
      }
    }
  }
  if (!hasReadings(summary)) {
    const pending = summary?.scoreState === "PENDING_SCORE" || summary?.cycleScoreState === "PENDING_SCORE";
    return { ...current, connected: payload.connected ?? current.connected, status: partial ? "partial" : "empty", summary: hasReadings(current.summary) ? current.summary : summary,
      retrievedAt: hasReadings(current.summary) ? current.retrievedAt : safeStamp(payload.retrievedAt),
      message: partial ? payload.error || "部分身体记录暂时无法读取，请重试。" : pending ? "WHOOP 仍在计算评分，目前没有可用读数。" : "已完成读取，近期暂无可用身体记录。", retained: hasReadings(current.summary), retainedFields: hasReadings(current.summary) ? [...VALUE_KEYS] : [] };
  }
  return { connected: payload.connected ?? current.connected, status: partial ? "partial" : "synced", summary,
    retrievedAt: safeStamp(payload.retrievedAt), retained: retainedFields.length > 0, retainedFields,
    message: partial ? payload.error || "部分身体记录读取失败，可先查看已读取的数据并稍后重试。" : "WHOOP 身体记录已读取。" };
}
export function whoopStatusLabel(status: WhoopDisplayStatus) {
  return ({ checking: "读取授权中", not_connected: "未授权", connected: "授权已保存", syncing: "读取中", synced: "读取成功", partial: "部分读取失败", empty: "近期暂无记录", failed: "读取失败", reauthorization_required: "需要重新授权" })[status];
}
export function whoopMetricLabel(state: WhoopDisplay, value: number | null | undefined, key?: keyof WhoopSummary) {
  if (value != null && Number.isFinite(value)) return state.status === "syncing" || state.retained && (!key || state.status !== "partial" || state.retainedFields.includes(key)) ? "上次成功读数" : "WHOOP 最近记录";
  if (state.status === "failed" || state.status === "partial") return "本次未读取到";
  if (state.status === "reauthorization_required") return "重新授权后可读取";
  if (state.status === "syncing" || state.status === "checking") return "正在读取…";
  if (state.status === "not_connected") return "尚未授权 WHOOP";
  const recovery = !key || ["recoveryScore", "hrvRmssdMilli", "restingHeartRate"].includes(key);
  const cycle = !key || key === "cycleStrain";
  if (recovery && state.summary?.scoreState === "PENDING_SCORE" || cycle && state.summary?.cycleScoreState === "PENDING_SCORE") return "等待 WHOOP 评分";
  return "近期暂无此项记录";
}
/** Preserve HTTP 409 flags instead of losing them in a generic JSON error. */
export async function readWhoopResponse(response: Response): Promise<WhoopSummaryResponse> {
  const value: unknown = await response.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "WHOOP 返回的数据暂时无法读取，请重试。" };
  return value as WhoopSummaryResponse;
}
