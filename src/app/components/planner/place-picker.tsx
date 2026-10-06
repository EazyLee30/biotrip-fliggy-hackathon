"use client";

import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { Icon } from "../zen-ui";
import {
  GROUP_LABELS, INTERNATIONAL_GROUPS,
  PLACES as CATALOG_PLACES, groupByInitial, popularFirst, searchPlaces, selectablePlaces,
} from "@/lib/places";
import type { Place as CatalogPlace, PlaceGroup } from "@/lib/places";
import { beginSheetDrag, closestIndexAt, moveSheetDrag, shouldDismissSheet, type SheetDrag } from "./sheet-gesture";
import styles from "./place-picker.module.css";

/** Preserve the original trigger API while sharing the catalog with the dialog. */
export type Place = CatalogPlace & { region: string };
export type ResolvedPlace = CatalogPlace;
export const PLACES: readonly Place[] = CATALOG_PLACES.map((place) => ({ ...place, region: GROUP_LABELS[place.group] }));
export const ORIGIN_PLACES: readonly Place[] = PLACES.filter((place) => ["上海", "北京", "广州", "深圳", "杭州", "香港", "东京", "新加坡"].includes(place.city));

export type PlacePickerDialogProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (place: ResolvedPlace) => void;
  title?: string;
  current?: ResolvedPlace | null;
  suggestions?: readonly string[];
  exclude?: string;
  /** Departure selection admits actual cities, while destinations also admit areas. */
  citiesOnly?: boolean;
};

const FOCUSABLE = 'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const EMPTY_SUGGESTIONS: readonly string[] = [];

/** Shared by the two picker entry points; callback changes do not reset focus. */
function useDialogBehavior(ref: RefObject<HTMLDivElement | null>, onClose: () => void) {
  const close = useEffectEvent(onClose);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const body = document.body;
    const root = document.documentElement;
    const scrollX = window.scrollX, scrollY = window.scrollY;
    const previousBody = { overflow: body.style.overflow, position: body.style.position, top: body.style.top, left: body.style.left, width: body.style.width, paddingRight: body.style.paddingRight };
    const previousRootOverflow = root.style.overflow;
    const scrollbar = Math.max(0, window.innerWidth - root.clientWidth);
    const padding = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
    body.style.overflow = "hidden"; body.style.position = "fixed"; body.style.top = `${-scrollY}px`;
    body.style.left = `${-scrollX}px`; body.style.width = "100%";
    if (scrollbar) body.style.paddingRight = `${padding + scrollbar}px`;
    root.style.overflow = "hidden";
    const portal = dialog.parentElement;
    const siblings = Array.from(body.children).filter((element): element is HTMLElement => element instanceof HTMLElement && element !== portal);
    const inert = siblings.map((element) => ({ element, previous: element.inert }));
    for (const { element } of inert) element.inert = true;
    dialog.focus({ preventScroll: true });
    const nodes = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => element.getClientRects().length > 0);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key !== "Tab") return;
      const list = nodes(), first = list[0], last = list.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
      const current = document.activeElement;
      if (event.shiftKey && (current === first || current === dialog || !dialog.contains(current))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (current === last || !dialog.contains(current))) { event.preventDefault(); first.focus(); }
    };
    const focusin = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) (nodes()[0] ?? dialog).focus({ preventScroll: true });
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focusin);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", focusin);
      for (const { element, previous: wasInert } of inert) element.inert = wasInert;
      Object.assign(body.style, previousBody); root.style.overflow = previousRootOverflow;
      const previousBehavior = root.style.scrollBehavior; root.style.scrollBehavior = "auto";
      window.scrollTo(scrollX, scrollY); root.style.scrollBehavior = previousBehavior;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [ref]);
}

function CityDialog({ onClose, onSelect, title = "选择目的地", current, suggestions = EMPTY_SUGGESTIONS, exclude, citiesOnly = false }: Omit<PlacePickerDialogProps, "open">) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"domestic" | "international">(() => current && !current.domestic ? "international" : "domestic");
  const [region, setRegion] = useState<PlaceGroup | "popular">("popular");
  const [letter, setLetter] = useState("热");
  const [indexPreview, setIndexPreview] = useState<{ letter: string; top: number } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const sections = useRef(new Map<string, HTMLElement>());
  const sheetDrag = useRef<SheetDrag | null>(null);
  const indexPointer = useRef<number | null>(null);
  const suppressIndexClick = useRef(false);
  const headingId = useId(), searchId = useId();
  useDialogBehavior(dialog, onClose);

  const eligible = useMemo(() => selectablePlaces(CATALOG_PLACES, { exclude, citiesOnly }), [exclude, citiesOnly]);
  const domestic = useMemo(() => eligible.filter((place) => place.domestic), [eligible]);
  const international = useMemo(() => eligible.filter((place) => !place.domestic), [eligible]);
  const domesticGroups = useMemo(() => groupByInitial(domestic), [domestic]);
  const popularDomestic = useMemo(() => popularFirst(domestic.filter((place) => place.popular || suggestions.includes(place.city)), suggestions).slice(0, 24), [domestic, suggestions]);
  const internationalCities = useMemo(() => region === "popular"
    ? popularFirst(international.filter((place) => place.popular || suggestions.includes(place.city)), suggestions).slice(0, 30)
    : popularFirst(international.filter((place) => place.group === region), suggestions), [international, region, suggestions]);
  const matches = useMemo(() => searchPlaces(query, eligible), [query, eligible]);
  const searching = query.trim().length > 0;

  function choose(place: CatalogPlace) { onSelect(place); onClose(); }
  function selectTab(value: "domestic" | "international") {
    setTab(value); setLetter("热"); scroll.current?.scrollTo({ top: 0 });
  }
  function selectRegion(value: PlaceGroup | "popular") { setRegion(value); scroll.current?.scrollTo({ top: 0 }); }
  const jump = useCallback((initial: string) => {
    const container = scroll.current, target = sections.current.get(initial);
    if (!container || !target) return;
    container.scrollTo({ top: container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top, behavior: "auto" });
    setLetter(initial);
  }, []);
  const beginDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || !window.matchMedia("(max-width: 639px)").matches || event.target instanceof Element && event.target.closest("button,a,input")) return;
    sheetDrag.current = beginSheetDrag(event.pointerId, event.clientX, event.clientY, event.timeStamp);
    event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
    event.preventDefault();
  }, []);
  const moveDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const current = sheetDrag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    sheetDrag.current = moveSheetDrag(current, event.clientX, event.clientY, event.timeStamp);
    setDragOffset(sheetDrag.current.offset);
  }, []);
  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const current = sheetDrag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const result = moveSheetDrag(current, event.clientX, event.clientY, event.timeStamp);
    sheetDrag.current = null; setDragging(false); setDragOffset(0);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (shouldDismissSheet(result, dialog.current?.clientHeight ?? 600)) onClose();
  }, [onClose]);
  const cancelDrag = useCallback(() => { sheetDrag.current = null; setDragging(false); setDragOffset(0); }, []);
  const locateIndex = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const rail = event.currentTarget, buttons = Array.from(rail.querySelectorAll<HTMLButtonElement>("button[data-initial]"));
    const index = closestIndexAt(event.clientY, buttons.map((button) => { const rect = button.getBoundingClientRect(); return rect.top + rect.height / 2; }));
    const initial = buttons[index]?.dataset.initial;
    if (!initial) return;
    jump(initial);
    const body = rail.parentElement?.getBoundingClientRect();
    if (body) setIndexPreview({ letter: initial, top: Math.max(30, Math.min(body.height - 30, event.clientY - body.top)) });
  }, [jump]);
  const beginIndex = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    indexPointer.current = event.pointerId; suppressIndexClick.current = true;
    event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); locateIndex(event);
  }, [locateIndex]);
  const moveIndex = useCallback((event: ReactPointerEvent<HTMLElement>) => { if (indexPointer.current === event.pointerId) { event.preventDefault(); locateIndex(event); } }, [locateIndex]);
  const endIndex = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (indexPointer.current !== event.pointerId) return;
    indexPointer.current = null; setIndexPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);
  function trackLetter() {
    if (searching || tab !== "domestic" || !scroll.current || indexPointer.current !== null) return;
    const top = scroll.current.getBoundingClientRect().top + 24;
    let active = "热";
    for (const [initial, element] of sections.current) if (element.getBoundingClientRect().top <= top) active = initial;
    setLetter((previous) => previous === active ? previous : active);
  }
  function cityButton(place: CatalogPlace, country = false) {
    return <button key={place.city} type="button" className={`${styles.city} ${place.city === current?.city ? styles.selected : ""}`} aria-pressed={place.city === current?.city} onClick={() => choose(place)}>
      <span>{place.city}</span>{country ? <small><span aria-hidden="true">{place.flag}</span> {place.country}</small> : null}
    </button>;
  }
  const panelId = `${headingId}-panel`;
  return createPortal(<div className={styles.backdrop} onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={`${styles.dialog} ${dragging ? styles.dragging : ""}`} style={dragOffset ? { translate: `0 ${dragOffset}px` } : undefined} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1} ref={dialog}>
      <div className={styles.sheetTop} data-sheet-drag-handle="city" onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}><div className={styles.grab} aria-hidden="true" />
      <header className={styles.heading}><h2 id={headingId}>{title}</h2><button type="button" className={styles.close} aria-label={`关闭${title}`} onClick={onClose}><Icon name="close" size={20} /></button></header></div>
      <div className={styles.search}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg><input id={searchId} type="search" value={query} onChange={(event) => { setQuery(event.target.value); scroll.current?.scrollTo({ top: 0 }); }} placeholder="城市 / 国家 / 拼音" aria-label={`搜索${title.replace(/^选择/, "")}`} autoComplete="off" maxLength={100} />{query ? <button type="button" aria-label="清空搜索" onClick={() => { setQuery(""); document.getElementById(searchId)?.focus(); }}><Icon name="close" size={15} /></button> : null}</div>
      <div className={styles.tabs} role="tablist" aria-label="目的地区域"><button id={`${headingId}-domestic`} type="button" role="tab" aria-selected={tab === "domestic"} aria-controls={panelId} onClick={() => selectTab("domestic")}>国内</button><button id={`${headingId}-international`} type="button" role="tab" aria-selected={tab === "international"} aria-controls={panelId} onClick={() => selectTab("international")}>国际 / 中国港澳台</button></div>
      <div className={`${styles.body} ${searching ? styles.searchBody : tab === "domestic" ? styles.domesticBody : styles.internationalBody}`} id={panelId} role="tabpanel" aria-labelledby={`${headingId}-${tab}`}>
        {!searching && tab === "international" ? <nav className={styles.regionRail} aria-label="国际地区"><button type="button" aria-pressed={region === "popular"} onClick={() => selectRegion("popular")}>热门</button>{INTERNATIONAL_GROUPS.map((group) => <button key={group} type="button" aria-pressed={region === group} onClick={() => selectRegion(group)}>{GROUP_LABELS[group]}</button>)}</nav> : null}
        <div className={styles.contentScroll} ref={scroll} onScroll={trackLetter}>
          {searching ? <section className={styles.section}><h3>搜索结果 <small>{matches.length} 个地点</small></h3>{matches.length ? <div className={styles.internationalGrid}>{matches.map((place) => cityButton(place, true))}</div> : <div className={styles.empty}><Icon name="compass" size={30} /><strong>没有找到这个地点</strong><p>试试中文城市名、拼音或国家名称。</p></div>}</section>
            : tab === "domestic" ? <><section className={styles.section} ref={(element) => { if (element) sections.current.set("热", element); else sections.current.delete("热"); }}><h3>热门城市</h3><div className={styles.domesticGrid}>{popularDomestic.map((place) => cityButton(place))}</div></section>{domesticGroups.map(([initial, cities]) => <section key={initial} className={styles.section} ref={(element) => { if (element) sections.current.set(initial, element); else sections.current.delete(initial); }}><h3>{initial}</h3><div className={styles.domesticGrid}>{cities.map((place) => cityButton(place))}</div></section>)}</>
              : <section className={styles.section}><h3>{region === "popular" ? "热门目的地" : GROUP_LABELS[region]}</h3><div className={styles.internationalGrid}>{internationalCities.map((place) => cityButton(place, true))}</div></section>}
        </div>
        {!searching && tab === "domestic" ? <nav className={styles.alphabetRail} aria-label="按拼音首字母跳转，可上下滑动" onPointerDown={beginIndex} onPointerMove={moveIndex} onPointerUp={endIndex} onPointerCancel={endIndex} onLostPointerCapture={endIndex} onClickCapture={(event) => { if (event.detail > 0 && suppressIndexClick.current) { event.preventDefault(); event.stopPropagation(); suppressIndexClick.current = false; } }}><button type="button" data-initial="热" aria-label="跳转热门城市" aria-current={letter === "热" ? "location" : undefined} onClick={() => jump("热")}>热</button>{domesticGroups.map(([initial]) => <button key={initial} type="button" data-initial={initial} aria-label={`跳转 ${initial}`} aria-current={letter === initial ? "location" : undefined} onClick={() => jump(initial)}>{initial}</button>)}</nav> : null}
        {indexPreview ? <div className={styles.indexPreview} style={{ top: indexPreview.top }} aria-hidden="true">{indexPreview.letter}</div> : null}
      </div>
    </div>
  </div>, document.body);
}

/** Controlled entry point for route-summary buttons. Opening mounts a fresh search. */
export function PlacePickerDialog({ open, ...props }: PlacePickerDialogProps) {
  return open ? <CityDialog {...props} /> : null;
}

/** Original labeled field entry point, retained for existing callers. */
export function PlacePicker({ label, value, placeholder, suggestions, onSelect, exclude, citiesOnly }: {
  label: string; value: string; placeholder: string; suggestions?: readonly string[];
  onSelect: (place: Place) => void; exclude?: string; citiesOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const current = CATALOG_PLACES.find((place) => place.city === value) ?? null;
  return <div className={styles.field}><span id={labelId} className={styles.fieldLabel}>{label}</span><button type="button" className={styles.trigger} aria-label={`${label}，${value || placeholder}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>{value ? <span>{current?.flag ?? "📍"} {value}</span> : <span className={styles.placeholder}>{placeholder}</span>}<Icon name="arrow" size={16} /></button><PlacePickerDialog open={open} onClose={() => setOpen(false)} title={`选择${label}`} current={current} suggestions={suggestions} exclude={exclude} citiesOnly={citiesOnly} onSelect={(place) => onSelect({ ...place, region: GROUP_LABELS[place.group] })} /></div>;
}
