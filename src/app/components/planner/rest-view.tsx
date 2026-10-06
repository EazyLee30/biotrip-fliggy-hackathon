"use client";
import type * as React from "react";
import type { AppView, NavigationIntent } from "./app-navigation";
import styles from "../zen-dashboard.module.css";
import { Icon, Badge, Ambience } from "../zen-ui";
import { number } from "./view-values";

type Props = {
  health: import("@/lib/whoop-display").WhoopSummary | null;
  startAdjustment: (light?: boolean) => void;
  navigate: (next: AppView, intent?: NavigationIntent) => Promise<void>;
  navigateBack: () => Promise<void>;
};
export function RestView({ health, startAdjustment, navigate, navigateBack }: Props) { return <div className={styles.stack}><div className={styles.dangerBanner}><Icon name="heart" size={14} />身体感受由你告诉我 · 不是自动健康诊断</div><section className={styles.card}><span className={styles.eyebrow}>给旅程留一个停顿</span><div className={styles.sectionHead}><h1>累了，<br />就慢一点。</h1><Badge tone="rose"><Icon name="leaf" /></Badge></div><p>可以减少步行、安排坐下来休息的地方，或者提前结束今天的探索。你的固定安排会一起纳入重新规划。</p><div className={styles.metrics}><div className={styles.metric}><span>心率变异</span><strong>{number(health?.hrvRmssdMilli, 1)}</strong><small>毫秒 · 最近记录</small></div><div className={styles.metric}><span>活动负荷</span><strong>{number(health?.cycleStrain, 1)}</strong><small>WHOOP 周期记录</small></div><div className={styles.metric}><span>恢复指数</span><strong>{number(health?.recoveryScore)}<small>%</small></strong><small>最近记录</small></div></div><p className={styles.note}>这些历史记录不能证明此刻疲劳；新安排以你本次填写的感受为依据。</p></section><section className={styles.card}><div className={styles.sectionHead}><span><Icon name="leaf" /><h3>更从容的下一步</h3></span><Badge tone="mint">由你选择</Badge></div><Ambience image="tea" label="一处可以坐下来的安静角落" title="喝口水，休息一下。" /><div className={styles.inset}><Icon name="train" /><div><strong>减少走路，增加衔接空间</strong><p>告诉我你想放慢，我会检索适合的当地交通和休息体验，再生成完整的新安排。</p></div></div><button className={styles.primaryButton} onClick={() => startAdjustment(true)}>调整为轻松节奏 <Icon name="arrow" /></button><button className={styles.secondaryButton} onClick={() => navigate("breathing")}><Icon name="wind" />先做 3 分钟呼吸练习</button></section><button className={styles.textButton} onClick={() => void navigateBack()}>保留当前行程并返回</button></div>; }
