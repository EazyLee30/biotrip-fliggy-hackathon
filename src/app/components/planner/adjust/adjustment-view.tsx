"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Journey, ItineraryActivity } from "@/lib/journey-types";
import type { PlanningJob } from "@/lib/planning/jobs";
import type { PlanProgress } from "@/lib/plan-response";
import { bodyStatus, BODY_LEVEL_COPY } from "@/lib/adjust/status";
import { activityTags, dayLoad } from "@/lib/adjust/tags";
import { adjustmentScope } from "@/lib/adjust/request";
import { instantProposals } from "@/lib/adjust/rules";
import { bundle, BUNDLE_LABELS, markConflicts, resolveAccepted, type BundleName } from "@/lib/adjust/validate";
import { ANGLE_LABELS, CHECK_IN_LABELS, CHECK_IN_TAGS, SIGNAL_LABELS, STANCE_LABELS, STANCES, type CheckInTag, type Proposal, type Stance } from "@/lib/adjust/types";
import { productImageUrl, fliggyImage } from "@/lib/product-image";
import { Modal } from "../../zen-ui";
import { QuickRating } from "../quick-inputs";
import css from "./adjustment.module.css";

const ACTIVE = ["queued", "running", "cancel_requested"];
const STAGES = ["health_insight", "relief_inventory", "local_research", "mobility", "compose_adjustments"];
const LABELS: Record<string, string> = { health_insight: "身体解读", relief_inventory: "舒缓货架", local_research: "当地口碑", mobility: "出行顾问", compose_adjustments: "建议编排" };
type Request = <T>(url: string, options?: RequestInit) => Promise<T>;
type Props = { journey: Journey; request: Request; onSaved: (journey: Journey) => void; onBreathing: () => void; onVersions: () => void; whoopConnected: boolean };

/** A journey-keyed component owns its check-in and resumable consultation. */
export function AdjustmentView({ journey, request, onSaved, onBreathing, onVersions, whoopConnected }: Props) {
  const [fatigue, setFatigue] = useState("");
  const [stress, setStress] = useState("");
  const [tags, setTags] = useState<CheckInTag[]>([]);
  const [stance, setStance] = useState<Stance>("balanced");
  const [includeWhoop, setIncludeWhoop] = useState(false);
  const [consent, setConsent] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [job, setJob] = useState<PlanningJob | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [progress, setProgress] = useState<Record<string, PlanProgress>>({});
  const [instant, setInstant] = useState<Proposal[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const cursor = useRef(0);
  const alive = useRef(true);
  const submitting = useRef(false);
  const retry = useRef<{ key: string; body: string } | null>(null);
  const itinerary = journey.plan!.plan.itinerary;
  const scope = adjustmentScope(journey);
  const trip = journey.draft.trip!;
  const status = bodyStatus({ checkIn: { fatigue: fatigue ? Number(fatigue) : null, stress: stress ? Number(stress) : null, tags }, remaining: dayLoad(itinerary, scope.date) });
  const proposals = job?.adjustment?.proposals ?? instant ?? [];
  const running = Boolean(job && ACTIVE.includes(job.state));
  const awaiting = job?.state === "awaiting_approval";
  const locked = pending || running || awaiting;
  const expired = scope.date > scope.throughDate || journey.status === "completed";
  const preview = useMemo(() => {
    if (!selected.length) return { itinerary, error: "" };
    try { return { itinerary: resolveAccepted(proposals, selected, itinerary, trip, job?.adjustment?.scope ?? scope).itinerary, error: "" }; }
    catch (error) { return { itinerary, error: error instanceof Error ? error.message : "这些建议无法同时应用。" }; }
  }, [selected, proposals, itinerary, trip, job?.adjustment?.scope, scope.date, scope.fromTime, scope.throughDate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    alive.current = true;
    void request<{ jobs: PlanningJob[] }>("/api/plan/jobs").then(result => {
      if (!alive.current) return;
      const saved = result.jobs.find(entry => entry.mode === "adjust" && entry.journeyId === journey.id && (ACTIVE.includes(entry.state) || entry.state === "awaiting_approval"));
      if (saved) { cursor.current = 0; setJob(saved); setNotice("已恢复这次调整建议。"); }
    }).catch(() => { if (alive.current) setError("后台任务暂时无法读取，提交时会再次检查。"); });
    return () => { alive.current = false; };
  }, [journey.id, request]);

  useEffect(() => {
    if (!job || !ACTIVE.includes(job.state)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const result = await request<{ job: PlanningJob; events: Array<{ seq: number; kind: string; payload: PlanProgress }> }>(`/api/plan/jobs/${job!.id}?after=${cursor.current}`, { signal: controller.signal });
        if (stopped) return;
        for (const event of result.events) {
          cursor.current = Math.max(cursor.current, event.seq);
          if (event.kind === "progress") setProgress(current => ({ ...current, [event.payload.stage]: event.payload }));
        }
        setReconnecting(false); setJob(result.job);
        if (["failed", "indeterminate", "cancelled"].includes(result.job.state)) setNotice(result.job.error || "会诊已停止，基础建议仍可参考。重新获取后可应用。");
        if (!ACTIVE.includes(result.job.state)) return;
      } catch { if (!stopped) setReconnecting(true); }
      if (!stopped) timer = setTimeout(poll, 1800);
    }
    void poll();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [job?.id, job?.state, request]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    if (!consent || submitting.current) return;
    submitting.current = true; setPending(true); setError(""); setNotice("");
    const fresh = adjustmentScope(journey);
    const local = markConflicts(instantProposals({ itinerary, trip, scope: fresh, status, stance }), itinerary, trip, fresh);
    setInstant(local); setSelected([]); setProgress({}); cursor.current = 0; setConsentOpen(false);
    const body = JSON.stringify({ mode: "adjust", journeyId: journey.id, expectedVersion: journey.version, consent: true, includeWhoop, includeMemory: false,
      checkIn: { fatigue: fatigue ? Number(fatigue) : null, stress: stress ? Number(stress) : null, tags }, stance, scope: fresh });
    if (!retry.current) retry.current = { key: crypto.randomUUID(), body };
    try {
      const result = await request<{ job: PlanningJob }>("/api/plan/jobs", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": retry.current.key }, body: retry.current.body });
      if (alive.current) { setJob(result.job); retry.current = null; }
    } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : "提交未确认，请重试恢复同一次任务。"); }
    finally { submitting.current = false; if (alive.current) { setPending(false); setConsent(false); } }
  }
  async function decide(action: "apply" | "discard") {
    if (!job || submitting.current) return;
    submitting.current = true; setPending(true); setError("");
    try {
      const result = await request<{ job: PlanningJob; journey?: Journey }>(`/api/plan/jobs/${job.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, version: journey.version, accept: selected }) });
      if (!alive.current) return;
      setJob(result.job); setSelected([]); setInstant(null);
      if (result.journey) { onSaved(result.journey); setNotice("所选建议已应用。原安排可从版本历史恢复。"); }
      else setNotice("已保留当前行程。");
    } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : "原行程仍保留，请重试。"); }
    finally { submitting.current = false; if (alive.current) setPending(false); }
  }
  async function cancel() {
    if (!job || submitting.current) return;
    submitting.current = true; setPending(true); setError("");
    try { const result = await request<{ job: PlanningJob }>(`/api/plan/jobs/${job.id}`, { method: "DELETE" }); if (alive.current) setJob(result.job); }
    catch (error) { if (alive.current) setError(error instanceof Error ? error.message : "停止请求尚未确认。"); }
    finally { submitting.current = false; if (alive.current) setPending(false); }
  }
  function choose(id: string) {
    setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current.filter(value => !proposals.find(proposal => proposal.id === id)?.conflictsWith?.includes(value)), id]);
  }
  const total = selected.map(id => proposals.find(p => p.id === id)!).filter(Boolean).reduce((sum, p) => ({ rest: sum.rest + (p.effect.restMinutes ?? 0), walk: sum.walk + (p.effect.walkMinutes ?? 0), min: sum.min + (p.effect.costCny?.[0] ?? 0), max: sum.max + (p.effect.costCny?.[1] ?? 0) }), { rest: 0, walk: 0, min: 0, max: 0 });

  return <div className={css.root}>
    <section className={css.hero}>
      <span className={css.eyebrow}>BIOTRIP · 跟随此刻的感受</span>
      <div className={`${css.orb} ${css[status.level]}`} aria-hidden="true" />
      <h1>{BODY_LEVEL_COPY[status.level].title}</h1><p>{BODY_LEVEL_COPY[status.level].hint}</p>
      <p className={css.quiet}>{journey.draft.trip?.destinationCity} · {scope.date} · {itinerary.filter(item => item.fixed).length} 个固定安排受到保护</p>
      {expired ? <p role="status">这段旅程已结束，可以查看原安排与版本历史。</p> : <>
        <div className={css.chips}>{CHECK_IN_TAGS.map(tag => <button key={tag} aria-pressed={tags.includes(tag)} disabled={locked} onClick={() => { setTags(current => current.includes(tag) ? current.filter(value => value !== tag) : [...current, tag]); setConsent(false); }}>{CHECK_IN_LABELS[tag]}</button>)}</div>
        <div className={css.ratings}><QuickRating label="身体疲劳" value={fatigue} lowLabel="很轻" highLabel="明显" disabled={locked} onChange={value => { setFatigue(value); setConsent(false); }} /><QuickRating label="主观压力" value={stress} lowLabel="很低" highLabel="很高" disabled={locked} onChange={value => { setStress(value); setConsent(false); }} /></div>
        <div className={css.chips}>{STANCES.map(value => <button key={value} aria-pressed={stance === value} disabled={locked} onClick={() => { setStance(value); setConsent(false); }}>{STANCE_LABELS[value]}</button>)}</div>
        <button className={css.primary} disabled={locked || (!tags.length && !fatigue && !stress)} onClick={() => { setConsent(false); setConsentOpen(true); }}>给我调整建议</button>
      </>}
    </section>
    <section className={css.panel}><h2>接下来，哪一段更费体力？</h2><LoadRibbon items={preview.itinerary} date={scope.date} fromTime={scope.fromTime} /><p className={css.quiet}>强度按活动类型推断，是安排密度参考；图钉代表固定预约。</p></section>
    {(running || job?.adjustment) && <section className={css.panel} aria-label="顾问会诊进度"><h2>{running ? "顾问正在会诊" : "这份建议如何产生"}</h2><div className={css.stages}>{STAGES.map(stage => {
      const result = job?.adjustment?.stages.find(item => item.stage === stage);
      const event = progress[stage];
      const state = result?.status ?? event?.status ?? "waiting";
      const elapsed = result?.elapsedMs ?? event?.elapsedMs;
      return <div className={css.stage} key={stage} data-state={state}><span className={css.track} /><strong>{LABELS[stage]}</strong><small>{state === "ok" ? "已完成" : state === "degraded" ? "未核验 · 保留基础建议" : state === "running" ? "进行中" : "等待开始"}{elapsed !== undefined && elapsed >= 100 ? ` · ${(elapsed / 1000).toFixed(1)}s` : ""}</small></div>;
    })}</div>{running && <button className={css.secondary} disabled={pending || job?.state === "cancel_requested"} onClick={() => void cancel()}>{job?.state === "cancel_requested" ? "正在确认停止" : "停止会诊"}</button>}{reconnecting && <p role="status">正在恢复进度连接，后台任务会继续。</p>}</section>}
    {proposals.length > 0 && <section className={css.panel}>
      <div className={css.heading}><h2>{awaiting ? "逐条选择，让今天舒服一点" : "先看看基础建议"}</h2><span>{proposals.length} 条</span></div>
      {awaiting && <div className={css.chips}>{(Object.keys(BUNDLE_LABELS) as BundleName[]).map(name => <button key={name} disabled={pending} onClick={() => setSelected(bundle(proposals, name, job?.adjustment?.stance ?? stance))}>{BUNDLE_LABELS[name]}</button>)}</div>}
      <div className={css.deck}>{proposals.map(proposal => <ProposalCard key={proposal.id} proposal={proposal} selected={selected.includes(proposal.id)} disabled={!awaiting || pending} onChoose={() => choose(proposal.id)} onBreathing={onBreathing} />)}</div>
      {running && <p className={css.quiet}>基础建议已经就绪；会诊完成后即可选择并应用。</p>}
    </section>}
    {awaiting && <section className={css.panel}><h2>调整后的安排预览</h2><p className={css.quiet}>仅应用你选择的建议，原行程仍然保留。</p>{preview.error && <p role="alert" className={css.error}>{preview.error}</p>}<div className={css.timeline}>{preview.itinerary.filter(item => item.date === scope.date && item.time >= scope.fromTime).map(item => <div key={item.id}><time>{item.time}</time><span>{item.fixed ? "📌 " : ""}{item.name}</span>{item.move?.mode === "taxi" || item.move?.mode === "transit" ? <small>{item.move.mode === "taxi" ? "打车前往" : "公共交通"} · {item.move.basis === "amap" ? "高德估算" : "以地图为准"}</small> : null}</div>)}</div>
      <div className={css.summary} aria-live="polite">已选 {selected.length} 条{total.rest > 0 ? ` · 计划休息 +${total.rest} 分钟` : ""}{total.walk < 0 ? ` · 步行 ${total.walk} 分钟` : ""}{total.max > 0 ? ` · 来源报价 ¥${total.min}–${total.max}，以页面为准` : ""}</div>
      <div className={css.actions}><button className={css.primary} disabled={pending || !selected.length || Boolean(preview.error) || !selected.some(id => proposals.find(p => p.id === id)?.templates.length)} onClick={() => void decide("apply")}>{pending ? "保存中…" : "应用所选建议"}</button><button className={css.secondary} disabled={pending} onClick={() => void decide("discard")}>保留原行程</button></div>
    </section>}
    {error && <p role="alert" className={css.error}>{error}</p>}{notice && <p role="status" className={css.notice}>{notice}</p>}
    <button className={css.secondary} onClick={onVersions}>查看版本历史 · 恢复原安排</button>
    {consentOpen && <Modal title="确认本次调整的数据去向" onClose={() => setConsentOpen(false)}>
      <div className={css.consent}><p>城市与范围内的活动名称、时间用于舒缓货架检索。高德路线查询只接收城市和相邻活动的地点名称，必要时包含前一项起点；不读取当前 GPS，不发送日期或身体数据。当地口碑查询接收城市和旅行偏好。身体自评与预算倾向用于身体解读及无工具的建议编排。</p><p>基础建议在本机即时生成。顾问结果会保存为待确认建议，逐条采纳后才修改行程。</p>{whoopConnected && <label><input type="checkbox" checked={includeWhoop} onChange={e => { setIncludeWhoop(e.target.checked); setConsent(false); }} />本次可读取 WHOOP 近期记录，仅交给无工具的身体解读顾问</label>}<p>本次不使用旅程记忆；路线、价格、营业时间与预约均以来源页面为准。</p><label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />确认以上资料用于本次调整会诊</label><button className={css.primary} disabled={!consent || pending} onClick={() => void submit()}>确认并获取建议</button></div>
    </Modal>}
  </div>;
}

function LoadRibbon({ items, date, fromTime }: { items: ItineraryActivity[]; date: string; fromTime: string }) {
  const remaining = items.filter(item => item.date === date && item.time >= fromTime);
  return <div className={css.ribbon}>{remaining.length ? remaining.map(item => <div key={item.id} data-effort={activityTags(item).effort}><time>{item.time}</time><strong>{item.fixed ? "📌 " : ""}{item.name}</strong><small>{["", "坐下 / 轻松", "轻度走动", "较多步行"][activityTags(item).effort]}</small></div>) : <p>今天剩余时间留给自己。</p>}</div>;
}
function ProposalCard({ proposal: p, selected, disabled, onChoose, onBreathing }: { proposal: Proposal; selected: boolean; disabled: boolean; onChoose: () => void; onBreathing: () => void }) {
  const image = productImageUrl(p.source?.imageUrl);
  return <article className={css.proposal} data-selected={selected} data-angle={p.angle}>
    <span className={css.eyebrow}>{ANGLE_LABELS[p.angle]} · {p.tier === "instant" ? "基础建议" : "顾问建议"}</span><h3>{p.title}</h3><p>{p.reason}</p>
    {p.signals.length > 0 && <small>依据：{p.signals.map(signal => SIGNAL_LABELS[signal]).join(" · ")}</small>}
    <div className={css.effect}>{p.templates.map((template, index) => template.type === "swap_move" && template.basis === "amap" ? <span key={index}>{template.mode === "taxi" ? "驾车" : template.mode === "transit" ? "公共交通" : "步行"}约 {template.minutes} 分钟{template.km !== undefined ? ` · ${template.km} km` : ""}</span> : null)}{p.effect.restMinutes ? <span>计划休息 +{p.effect.restMinutes} 分钟</span> : null}{p.effect.timeMinutes ? <span>安排用时 {p.effect.timeMinutes > 0 ? "+" : ""}{p.effect.timeMinutes} 分钟</span> : null}{p.effect.costCny ? <span>{p.effect.basis === "amap" ? "预计车费" : "来源报价"} ¥{p.effect.costCny[0]} · 以页面为准</span> : null}<small>{p.effect.basis === "amap" ? "高德估算" : p.effect.basis === "source" ? "来源页面报价" : p.effect.basis === "estimate" ? "计划时长估算" : "距离与费用未核验"}</small></div>
    {p.source && <a className={css.source} href={p.source.url} target="_blank" rel="noopener noreferrer">{image && <Image width={56} height={56} unoptimized src={fliggyImage(image, 160) ?? image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={e => { if (e.currentTarget.src !== image) e.currentTarget.src = image; else e.currentTarget.hidden = true; }} />}<span>{p.source.name}<small>{p.source.kind.startsWith("fliggy") ? "飞猪 · 查看来源 ↗" : "当地公开来源 ↗"}</small></span></a>}
    {p.action === "breathing" ? <button className={css.secondary} onClick={onBreathing}>开始呼吸练习</button> : <button className={selected ? css.primary : css.secondary} disabled={disabled} aria-pressed={selected} onClick={onChoose}>{selected ? "已采纳 · 点击撤销选择" : "采纳这条"}</button>}
    {selected && Boolean(p.conflictsWith?.length) && <small>互斥建议会自动取消选择；应用前还会检查整体时间冲突。</small>}
  </article>;
}
