export const HABITS = [
 {value:"rest",label:"午后歇一会",note:"旅行时喜欢午后留出坐下来休息的时间",icon:"tea"},
 {value:"late",label:"不赶早",note:"旅行时尽量不要安排早起",icon:"sun"},
 {value:"quiet",label:"安静一点",note:"旅行时偏好安静、人少的环境",icon:"leaf"},
 {value:"short_walk",label:"少连续步行",note:"旅行时喜欢减少连续步行，穿插休息",icon:"walk"},
] as const;
export const PACES = [
 {value:"gentle",label:"轻松慢游",note:"旅行通常选择轻松节奏，每天少安排一些活动",count:2},
 {value:"balanced",label:"走走停停",note:"旅行通常选择均衡节奏，活动与休息交替",count:3},
 {value:"active",label:"多看一点",note:"旅行通常喜欢充分探索，接受较密集的活动",count:5},
] as const;
export type OnboardingAnswers = {pace:string;habits:string[];homeCity:string;food:string};
export function onboardingNotes(a:OnboardingAnswers) {
 return [
  ...PACES.filter(p=>p.value===a.pace).map(p=>({category:"pace",value:p.value,note:p.note})),
  ...HABITS.filter(p=>a.habits.includes(p.value)).map(p=>({category:"habit",value:p.value,note:p.note})),
  ...(a.homeCity?[{category:"home",value:a.homeCity,note:`通常从${a.homeCity}出发旅行`}]:[]),
  ...(a.food?[{category:"food",value:a.food,note:`饮食偏好或限制：${a.food}`}]:[]),
 ];
}
