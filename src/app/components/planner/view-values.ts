export const SERVICES = [["flights", "航班"], ["hotels", "住宿"], ["attractions", "景点"], ["transport", "当地交通"], ["local_food", "当地餐食"], ["relaxation", "放松体验"], ["onsen", "温泉"], ["massage", "按摩"], ["travel_insurance", "旅行保险"], ["medical_info", "医疗信息"]] as const;
export const AMBIENCE = ["安静少噪", "自然气息", "柔和光线", "人少宽松"];
export const INTENTS = [
  { value: "安静恢复", name: "静心修复", subtitle: "深度休息与舒缓", icon: "leaf" as const, detail: "给睡眠、安静空间和休息多留一些时间，以轻松的节奏重新充电。", tags: ["轻松步行", "充足留白"] },
  { value: "慢慢探索", name: "平衡探索", subtitle: "温柔发现，一路从容", icon: "compass" as const, detail: "在街巷、展馆和当地文化之间慢慢走，把探索与坐下来休息安排在一起。", tags: ["文化体验", "灵活衔接"] },
  { value: "补充活力", name: "自然感官之旅", subtitle: "靠近自然，补充活力", icon: "forest" as const, detail: "寻找绿意、自然光和开阔空间，结合你实际的身体感受安排活动密度。", tags: ["自然气息", "适度活动"] },
  { value: "未指定", name: "城市随心漫游", subtitle: "美食与城市生活", icon: "food" as const, detail: "不用设定目标，跟随你的口味与兴趣，把喜欢的餐食、空间和体验连成旅程。", tags: ["地方餐食", "自由选择"] },
];
export const STEP_LABELS = ["目的地与时间", "节奏与预约", "确认资料", "行程回顾"];
export function toggle(items: string[], item: string) { return items.includes(item) ? items.filter((value) => value !== item) : [...items, item]; }
export function number(value: number | null | undefined, digits = 0) { return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—"; }
export function sleepDuration(value: number | null | undefined) { return typeof value === "number" ? `${Math.floor(value / 60)} 时 ${Math.round(value % 60)} 分` : "—"; }
