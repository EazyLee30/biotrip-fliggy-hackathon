"use client";

import { ToggleSwitch } from "../toggle-switch";
import { useRef, useState } from "react";
import type { Journey } from "@/lib/journey-types";
import { DEFAULT_SHARE_OPTIONS, publicJourneySnapshot, type ShareOptions, type JourneyShareSnapshot } from "@/lib/journey-share";
import { shareThroughSystem } from "@/lib/browser-share";
import { PublicVisuals } from "./public-visuals";
import { SharePosterPanel } from "./share-poster-panel";
import { SELECTABLE_SHARE_ASSETS, shareCoverAsset, coverCaption } from "@/lib/visual-assets";
import { Icon, Modal } from "../zen-ui";
import styles from "../zen-dashboard.module.css";

export function ShareDialog({ journey, onClose, onCreated }: { journey: Journey; onClose: () => void; onCreated: () => void }) {
  const [options, setOptions] = useState<ShareOptions>({ ...DEFAULT_SHARE_OPTIONS });
  const [stage, setStage] = useState<"select" | "preview">("select");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [published, setPublished] = useState<JourneyShareSnapshot | null>(null);
  const [path, setPath] = useState("");
  const [copied, setCopied] = useState(false);
  const lock = useRef(false);
  const sharing = useRef(false);
  const [shareBusy, setShareBusy] = useState(false);
  const linkField = useRef<HTMLInputElement>(null);
  const plan = journey.plan?.plan;
  const preview = published ?? (journey.planCurrent && plan ? publicJourneySnapshot(journey, options) : null);
  const cover = shareCoverAsset(preview?.coverAssetId ?? options.coverAssetId);
  const url = path && typeof window !== "undefined" ? new URL(path, window.location.origin).href : "";
  async function publish() {
    if (lock.current || !confirmed || !journey.planCurrent || !plan) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ journeyId: journey.id, version: journey.version, ...options }) });
      const result = await response.json() as { path?: string; error?: string; share?: JourneyShareSnapshot };
      if (!response.ok || !result.path || !result.share || !/^\/share\/[A-Za-z0-9_-]{6,80}$/.test(result.path)) throw new Error(result.error || "暂时无法创建分享链接，请重试。");
      setPath(result.path); setPublished(result.share!); onCreated();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "暂时无法创建分享链接，请重试。"); }
    finally { lock.current = false; setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setError(""); }
    catch { linkField.current?.focus(); linkField.current?.select(); setError("请长按链接复制，或用浏览器的分享功能。"); }
  }
  async function share() {
    if (!url || sharing.current) return;
    sharing.current = true; setShareBusy(true); setError("");
    try {
      const result = await shareThroughSystem(navigator, { title: published?.headline || "BioTrip 旅程", url });
      if (result === "failed" || result === "unsupported") setError("系统分享暂不可用，可以复制链接。");
    } finally { sharing.current = false; setShareBusy(false); }
  }
  return <Modal title={path ? "分享或保存" : stage === "select" ? "选择分享内容" : "确认公开预览"} onClose={onClose} busy={busy} footer={path ? <div className={styles.actions}><button type="button" className={styles.primaryButton} onClick={() => void copy()}><Icon name="share" />{copied ? "已复制链接" : "复制链接"}</button>{typeof navigator !== "undefined" && typeof navigator.share === "function" ? <button type="button" className={styles.secondaryButton} disabled={shareBusy} onClick={() => void share()}>{shareBusy ? "分享面板打开中…" : "系统分享"}</button> : null}</div> : stage === "select" ? <button type="button" className={styles.primaryButton} disabled={!journey.planCurrent || !plan} onClick={() => { setStage("preview"); setConfirmed(false); }}>下一步 · 看预览 <Icon name="arrow" /></button> : <div className={styles.actions}><button className={styles.secondaryButton} disabled={busy} onClick={() => { setStage("select"); setConfirmed(false); }}>返回选内容</button><button type="button" className={styles.primaryButton} disabled={busy || !confirmed || !journey.planCurrent || !plan} onClick={() => void publish()}>{busy ? "正在创建链接…" : "发布这份预览"}</button></div>}>
    <div className={styles.stack}>
      <ol className={styles.shareSteps} aria-label="分享步骤">{["选内容", "看预览", "分享或保存"].map((label, index) => <li key={label} aria-current={index === (path ? 2 : stage === "select" ? 0 : 1) ? "step" : undefined}>{index + 1} · {label}</li>)}</ol>
      <p>链接可公开访问，90 天后失效，可在“我的”中撤回。只公开下方预览的文字、选定图片与来源，不附带 WHOOP 读数或个人档案。</p>
      {!journey.planCurrent ? <p role="alert">当前偏好已更新，请先生成新的行程后再分享。</p> : null}
      {!path && stage === "select" ? <><div className={styles.filterRow} role="group" aria-label="分享样式">{([ ["postcard", "旅行明信片"], ["journal", "行程手记"] ] as const).map(([template, label]) => <button className={`${styles.chip} ${options.template === template ? styles.active : ""}`} aria-pressed={options.template === template} key={template} onClick={() => setOptions(current => ({ ...current, template }))}>{label}</button>)}</div>
      <label className={styles.shareLinkField}><span>分享标题 · 最多 40 字</span><input value={options.title ?? ""} placeholder={preview?.headline} maxLength={80} onChange={event => setOptions(current => ({ ...current, title: Array.from(event.target.value).slice(0,40).join("") }))} /></label></> : null}
      {!path && stage === "select" ? <details className={styles.journeyNotes}><summary>挑选手记封面</summary><div className={styles.shareCoverChoices} role="group" aria-label="分享封面">{SELECTABLE_SHARE_ASSETS.map((asset) => <button type="button" key={asset.id} aria-pressed={cover.id === asset.id} disabled={busy} onClick={() => { setOptions((current) => ({ ...current, coverAssetId: asset.id })); setConfirmed(false); }} style={{ backgroundImage: `url(${asset.thumbnail})` }}><span>{asset.alt.split("，")[0]}</span></button>)}</div><small>封面为生成的旅行氛围图，不代表目的地或商户实景。</small></details> : null}
      {stage === "preview" || path ? <div className={styles.sharePreviewCover} style={{ backgroundImage: `url(${cover.src})` }} role="img" aria-label={cover.alt}><span>{coverCaption(cover)}</span></div> : null}
      {!path && stage === "select" ? <div className={styles.stack}>{([
        ["includePlaces", "公开检索到的当地体验与来源"], ["includeItinerary", "公开每日活动名称与时间"],
        ["includeSummary", "公开原始旅程摘要（请检查是否含个人感受）"], ["includeActivityDetails", "附带活动说明与地点"],
        ["includeExactDates", "附带具体出行日期"], ["includeFixed", "包含固定预约"],
      ] as const).map(([key, label]) => <label className={styles.checkLabel} key={key}><ToggleSwitch label={label} checked={options[key]} disabled={busy || (["includeActivityDetails", "includeExactDates", "includeFixed"].includes(key) && !options.includeItinerary)} onChange={(enabled) => { setOptions((current) => ({ ...current, [key]: enabled })); setConfirmed(false); }} /><span>{label}</span></label>)}</div> : null}
      {!path && stage === "select" && options.includePlaces ? <fieldset className={styles.shareSelection}><legend>挑选公开推荐</legend>{plan?.places.map(item => <label className={styles.checkLabel} key={item.url}><input type="checkbox" checked={options.selectedPlaceUrls === undefined || options.selectedPlaceUrls.includes(item.url)} onChange={event => setOptions(current => { const urls = current.selectedPlaceUrls ?? plan.places.map(place => place.url); return { ...current, selectedPlaceUrls: event.target.checked ? [...new Set([...urls, item.url])] : urls.filter(url => url !== item.url) }; })} /><span>{item.name}</span></label>)}</fieldset> : null}
      {!path && stage === "select" && journey.plan?.visuals?.cover.length ? <fieldset className={styles.stack}><legend>公开目的地图片 · 默认不公开，最多四张</legend>{journey.plan.visuals.cover.map(image => <label className={styles.checkLabel} key={image.url}><input type="checkbox" checked={options.selectedCoverUrls?.includes(image.url) ?? false} disabled={busy || (!options.selectedCoverUrls?.includes(image.url) && (options.selectedCoverUrls?.length ?? 0) >= 4)} onChange={event => setOptions(current => ({ ...current, selectedCoverUrls: event.target.checked ? [...(current.selectedCoverUrls ?? []), image.url] : (current.selectedCoverUrls ?? []).filter(url => url !== image.url) }))} /><span>{image.name} · {image.kind === "poi" ? "实景" : "商品图片"}</span></label>)}<small>图片随公开网页展示；下载海报仍使用所选手记封面。</small></fieldset> : null}
      {options.template === "postcard" && preview?.template === "journal" && !path ? <p className={styles.note}>当前内容较多，将使用分页行程手记，保留完整文字。减少至 3 项短推荐并关闭每日安排与摘要，可使用单页明信片。</p> : null}
      {stage === "preview" || path ? <section className={styles.sharePreview} aria-label="公开分享内容预览"><PublicVisuals images={preview?.coverImages} /><small>{preview?.destination}</small><h3>{preview?.headline}</h3><p>{preview?.summary}</p>{preview?.days?.map((day) => <div key={day.dayIndex}><h4>第 {day.dayIndex} 天{day.date ? ` · ${day.date}` : ""}</h4>{day.items.map((item, index) => <div className={styles.summaryRow} key={index}><span>{item.time}{item.fixed ? " · 固定安排" : ""}</span><div><strong>{item.name}</strong>{item.detail ? <p>{item.detail}</p> : null}</div></div>)}</div>)}{preview?.itinerary?.map((item, index) => <div className={styles.summaryRow} key={index}><span>{item.date} {item.time}{item.fixed ? " · 固定安排" : ""}</span><div><strong>{item.name}</strong><p>{item.detail}</p></div></div>)}{preview?.places.map((item, index) => <div className={styles.summaryRow} key={`${item.url}-${index}`}><div><strong>{item.name}</strong><a href={item.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{item.source} ↗</a></div><span>{item.category}</span></div>)}</section> : null}
      {path ? <><label className={styles.shareLinkField}><span className={styles.note}>链接</span><input aria-label="旅程分享链接" ref={linkField} readOnly value={url} onFocus={(event) => event.currentTarget.select()} /></label><a href={path} target="_blank" rel="noopener noreferrer" className={styles.textButton}>打开分享页面 ↗</a></> : stage === "preview" ? <label className={styles.checkLabel}><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /><span>我已查看预览，确认公开这些内容。</span></label> : null}
      {path && published ? <p className={styles.note}>对应行程版本 {published.journeyVersion ?? journey.version}。之后编辑旅程不会改写此链接；需要更新时请创建新版分享。</p> : null}
      {path && published ? <SharePosterPanel snapshot={published} url={url} /> : null}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    </div>
  </Modal>;
}
