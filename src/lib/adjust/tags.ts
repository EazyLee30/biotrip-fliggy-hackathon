import type { ActivityEffort, ActivityKind, ItineraryActivity } from "../journey-types";

/**
 * Reads what an activity demands of the traveller.
 *
 * Plans generated after structured tags existed carry `kind`, `effort` and
 * `durationMin`. Older plans only have a name and a sentence, so those are read
 * with keyword rules. The result is a planning density — how much standing and
 * walking a slot implies — and is never presented as a measurement of the body.
 */

export type ActivityTags = { kind: ActivityKind; effort: ActivityEffort; durationMin: number; inferred: boolean };

const DEFAULT_MINUTES: Record<ActivityKind, number> = {
  meal: 75, relax: 75, rest: 45, stay: 30, sight: 90, experience: 90, transit: 30, other: 60,
};

// Ordered: the first matching rule wins, so a tea house inside a wetland walk
// is still read as the walk it mostly is.
const RULES: ReadonlyArray<{ pattern: RegExp; kind: ActivityKind; effort: ActivityEffort }> = [
  { pattern: /徒步|登山|爬山|骑行|远足|古道|环湖|暴走|登顶/, kind: "experience", effort: 3 },
  { pattern: /按摩|足疗|推拿|SPA|spa|温泉|汤泉|泡汤|理疗/, kind: "relax", effort: 1 },
  { pattern: /休整|休息|午休|小憩|歇一会|歇歇|安静地待/, kind: "rest", effort: 1 },
  { pattern: /回住处|回酒店|返回酒店|返回住|入住|退房|民宿|住宿/, kind: "stay", effort: 1 },
  { pattern: /早餐|午餐|晚餐|夜宵|用餐|餐厅|餐馆|饭|菜|小吃|美食|火锅|面馆|下午茶|甜品|咖啡|茶馆|茶楼|品茗|吃点/, kind: "meal", effort: 1 },
  { pattern: /抵达|出发|机场|车站|高铁|航班|接送|返程|登机|乘车|换乘/, kind: "transit", effort: 1 },
  { pattern: /博物馆|美术馆|展览|展馆|剧院|演出|观影|游船|摇橹船|缆车|观景台/, kind: "sight", effort: 2 },
  { pattern: /步行|漫步|散步|逛|游览|古镇|老街|公园|景区|湿地|寺|塔|街区|市集|夜市|广场|园林|湖|山/, kind: "sight", effort: 2 },
];
const LESS_WALKING = /步行极少|步行很少|少走|不用走|坐着|全程坐/;
const MORE_WALKING = /较多步行|步行较多|全程步行|走得多|需要走/;

export function minutesOf(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}
export function clockOf(minutes: number): string {
  const bounded = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  return `${String(Math.floor(bounded / 60)).padStart(2, "0")}:${String(bounded % 60).padStart(2, "0")}`;
}

export function activityTags(item: ItineraryActivity): ActivityTags {
  const text = `${item.name} ${item.detail}`;
  const rule = RULES.find((entry) => entry.pattern.test(text));
  const kind = item.kind ?? rule?.kind ?? "other";
  let effort: ActivityEffort = item.effort ?? rule?.effort ?? 2;
  if (item.effort === undefined) {
    if (LESS_WALKING.test(text)) effort = 1;
    else if (MORE_WALKING.test(text) && effort < 3) effort = 3;
  }
  return {
    kind, effort,
    durationMin: item.durationMin ?? DEFAULT_MINUTES[kind],
    inferred: item.kind === undefined || item.effort === undefined || item.durationMin === undefined,
  };
}

export type ActivityLoad = ActivityTags & {
  id: string; date: string; time: string; name: string; fixed: boolean;
  /** Minutes this activity occupies before the next one starts. */
  minutes: number;
  /** Minute of day the activity is expected to end. */
  endsAt: number;
};

/**
 * One day as a load profile. An activity ends at its own duration, or when the
 * next one starts if that is sooner, so a generated plan with tight slots does
 * not report more time than the day contains.
 */
export function dayLoad(items: readonly ItineraryActivity[], date: string): ActivityLoad[] {
  const day = items.filter((item) => item.date === date && /^\d{2}:\d{2}$/.test(item.time))
    .slice().sort((a, b) => a.time.localeCompare(b.time));
  return day.map((item, index) => {
    const tags = activityTags(item);
    const start = minutesOf(item.time);
    const next = day[index + 1] ? minutesOf(day[index + 1].time) : Infinity;
    const minutes = Math.max(5, Math.min(tags.durationMin, next - start));
    return { ...tags, id: item.id ?? `${date}:${item.time}:${index}`, date, time: item.time, name: item.name, fixed: item.fixed, minutes, endsAt: start + minutes };
  });
}

/** Minutes on the feet for a stretch of the day: light walking counts half. */
export function activeMinutes(load: readonly ActivityLoad[]): number {
  return Math.round(load.reduce((total, item) => total + (item.effort === 3 ? item.minutes : item.effort === 2 ? item.minutes / 2 : 0), 0));
}
