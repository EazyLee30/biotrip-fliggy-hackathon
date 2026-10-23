import type { ItineraryActivity } from "@/lib/journey-types";
import { activityTags } from "@/lib/adjust/tags";
import css from "./body-experience.module.css";
export function DayLoadChart({ items, title="给今天留一点余地" }: { items: ItineraryActivity[]; title?:string }) {
  const blocks = items.filter(item=>!['completed','skipped'].includes(item.progress?.state ?? 'planned')).flatMap(item => {
    const tags = activityTags(item);
    return [...(item.move?.minutes ? [{kind:"travel",minutes:item.move.minutes,label:item.move.mode === "walk" ? "步行" : "交通"}] : []),{kind:tags.kind === "rest" || tags.kind === "relax" ? "rest" : "activity",minutes:tags.durationMin,label:item.name}];
  });
  const unknownTravel=items.some(item=>item.move && item.move.mode!=="none" && item.move.minutes==null && !["completed","skipped"].includes(item.progress?.state ?? "planned"));
  if (!blocks.length) return null;
  const sum = (kind:string)=>blocks.filter(b=>b.kind===kind).reduce((n,b)=>n+b.minutes,0);
  return <section className={css.load} aria-label="行程活动与休息分布"><div className={css.loadHead}><h3>{title}</h3><span>计划时长 · 含估算</span></div>
    <div className={css.loadBar} role="img" aria-label={`活动${sum("activity")}分钟，已知交通${sum("travel")}分钟，休息${sum("rest")}分钟`}>{blocks.map((b,i)=><span key={i} data-kind={b.kind} style={{flex:b.minutes}} title={`${b.label} · ${b.minutes} 分钟`}/>)}</div>
    <div className={css.legend}><span><i/>活动 {sum("activity")} 分</span><span><i/>{unknownTravel ? (sum("travel") ? `交通已知 ${sum("travel")} 分＋待核验` : "交通待核验") : `交通 ${sum("travel")} 分`}</span><span><i/>休息 {sum("rest")} 分</span></div>
  </section>;
}
