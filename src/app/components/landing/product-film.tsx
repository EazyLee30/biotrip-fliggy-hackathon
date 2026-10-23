"use client";

import { useRef, useState } from "react";
import { ArrowUpRight, Play } from "lucide-react";
import styles from "./landing.module.css";

const chapters = [
  { time: 0, stamp: "00:00", title: "一次更舒服的出发" },
  { time: 34, stamp: "00:34", title: "读懂身体 · WHOOP" },
  { time: 75, stamp: "01:15", title: "让行程跟随感受" },
  { time: 96, stamp: "01:36", title: "记录，让下一步更懂你" },
];

export function ProductFilm() {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState(false);

  async function play(time?: number) {
    const player = video.current;
    if (!player) return;
    if (time !== undefined) {
      player.currentTime = time;
      player.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    }
    try { await player.play(); setError(false); }
    catch { setError(true); }
  }

  return <>
    <div className={styles.filmPlayer}>
      <video ref={video} controls playsInline preload="none" poster="/landing/film-poster.webp" aria-label="BioTrip 产品宣传片，时长 2 分 37 秒" onPlay={() => setStarted(true)} onError={() => setError(true)}>
        <source src="/api/film/v3" type="video/mp4" />
        <track kind="captions" src="/film/biotrip-v3.vtt" srcLang="zh" label="中文" />
        你的浏览器暂不支持视频播放，请打开下方影片链接。
      </video>
      {!started && <button type="button" className={styles.playCover} onClick={() => void play()} aria-label="播放完整 BioTrip 影片"><span className={styles.playCircle}><Play size={24} fill="currentColor" strokeWidth={1.2} /></span><span>播放影片 <small>02:37</small></span></button>}
    </div>
    {error && <p className={styles.filmError} role="status">可使用播放器继续播放，或<a href="/api/film/v3">直接打开影片 <ArrowUpRight size={14} /></a>。</p>}
    <div className={styles.chapters} aria-label="影片章节">{chapters.map((chapter) => <button key={chapter.time} type="button" onClick={() => void play(chapter.time)}><span>{chapter.stamp}</span><strong>{chapter.title}</strong><ArrowUpRight size={16} /></button>)}</div>
  </>;
}
