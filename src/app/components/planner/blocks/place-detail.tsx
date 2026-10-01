import { useState } from "react";
import { Icon } from "../../zen-ui";
import styles from "../../zen-dashboard.module.css";
import type { JourneyGeneratedPlan } from "@/lib/journey-types";

/**
 * A place the traveller might actually stop at, with the one decision that
 * matters: when to go.
 *
 * The arrival window replaces an open text field. BioTrip never books anything —
 * choosing a slot only records an intent in the traveller's own itinerary, and
 * the supplier's page stays the authority on price and availability.
 */

const WINDOWS = [
  { time: "14:30", label: "优先入场", note: "最不拥挤" },
  { time: "15:00", label: "可预约", note: "" },
  { time: "15:30", label: "可预约", note: "" },
  { time: "16:00", label: "可预约", note: "" },
] as const;

type Place = JourneyGeneratedPlan["plan"]["places"][number];

export type SlotIntent = { placeName: string; url: string; time: string } | null;

export function PlaceDetail({
  place,
  whoopConnected,
  onAddToDay,
  onClose,
  busy,
}: {
  place: Place;
  whoopConnected: boolean;
  onAddToDay: (slot: SlotIntent) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [slot, setSlot] = useState<string>(WINDOWS[1].time);
  const [added, setAdded] = useState(false);

  function add() {
    onAddToDay({ placeName: place.name, url: place.url, time: slot });
    setAdded(true);
  }

  return (
    <div className={styles.placeDetail}>
      <div className={styles.placeDetailHead}>
        <span className={styles.chip}><Icon name="shield" size={12} />有来源的旅行信息</span>
        <button type="button" className={styles.iconButton} aria-label="关闭" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>

      <h2>{place.name}</h2>
      <p className={styles.placeDetailMeta}>{place.category} · {place.source}</p>
      <p className={styles.placeDetailReason}>{place.reason}</p>

      <div className={styles.sectionHead}>
        <strong><Icon name="calendar" size={15} />今天可以到这里</strong>
      </div>
      <div className={styles.slotRow} role="radiogroup" aria-label="选择到达时段">
        {WINDOWS.map((option) => (
          <button
            key={option.time}
            type="button"
            role="radio"
            aria-checked={slot === option.time}
            className={`${styles.slot} ${slot === option.time ? styles.active : ""}`}
            onClick={() => { setSlot(option.time); setAdded(false); }}
          >
            <strong>{option.time}</strong>
            <small>{option.label}</small>
            {option.note && <small>{option.note}</small>}
          </button>
        ))}
      </div>
      <p className={styles.note}>时段是你此刻的意向，不是预订。价格与可订状态以打开后的供应商页面为准。</p>

      <button className={styles.primaryButton} disabled={busy || added} onClick={add}>
        <Icon name={added ? "check" : "plus"} />
        {added ? `已加入今天 ${slot}` : `加入今天 ${slot} 的安排`}
      </button>

      <a className={styles.secondaryButton} href={place.url} target="_blank" rel="noopener noreferrer">
        打开来源页面 ↗
      </a>

      {whoopConnected && (
        <div className={styles.inset}>
          <Icon name="pulse" size={16} />
          <p>你已连接 WHOOP。重新规划时会参考近期记录；本次浏览不会发送任何身体数据。</p>
        </div>
      )}
    </div>
  );
}