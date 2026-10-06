export type TravelDateRange = { start: string; end: string };
export type DateSelection = TravelDateRange & { phase: "departure" | "return" };

/** Date-only arithmetic deliberately uses UTC, independent of the browser zone. */
export function isTravelDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function addTravelDays(value: string, days: number): string {
  if (!isTravelDate(value)) return "";
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function travelDateLabel(value: string, weekday = false): string {
  if (!isTravelDate(value)) return "请选择";
  const label = `${Number(value.slice(5, 7))}月${Number(value.slice(8))}日`;
  return weekday ? `${label} ${new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", weekday: "short" }).format(new Date(`${value}T12:00:00Z`))}` : label;
}
export function travelDuration(start: string, end: string): { days: number; nights: number } | null {
  if (!isTravelDate(start) || !isTravelDate(end) || end < start) return null;
  const nights = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
  return { days: nights + 1, nights };
}
export function validateTravelRange(start: string, end: string, today: string, allowPast = false): string {
  if (!isTravelDate(start)) return "请选择有效的出发日期。";
  if (!allowPast && isTravelDate(today) && start < today) return "出发日期已过去，请重新选择。";
  if (end && !isTravelDate(end)) return "请选择有效的返程日期。";
  if (end && end < start) return "返程日期应晚于或等于出发日期。";
  return "";
}
export function selectTravelDate(current: DateSelection, day: string): DateSelection {
  if (!isTravelDate(day)) return current;
  if (current.phase === "departure" || !current.start || day < current.start) return { start: day, end: "", phase: "return" };
  return { start: current.start, end: day, phase: "departure" };
}
export function monthDates(month: string): Array<string | null> {
  const first = `${month}-01`;
  if (!isTravelDate(first)) return [];
  const date = new Date(`${first}T00:00:00Z`), leading = (date.getUTCDay() + 6) % 7;
  const last = new Date(date.getTime()); last.setUTCMonth(last.getUTCMonth() + 1, 0);
  return [...Array.from({ length: leading }, () => null), ...Array.from({ length: last.getUTCDate() }, (_, index) => addTravelDays(first, index))];
}
export function nextTravelMonth(month: string, delta: number): string {
  if (!isTravelDate(`${month}-01`)) return "";
  const date = new Date(`${month}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}
