"use client";
import Image from "next/image";
import { fliggyImage, productImageUrl } from "@/lib/product-image";
import type { JourneyVisuals } from "@/lib/journey-types";
import type { ItineraryItem } from "@/lib/itinerary-edit";
import { Badge, Icon } from "../zen-ui";
import styles from "../zen-dashboard.module.css";

export function activityIcon(name: string) { return /交通|地铁|列车|巴士|航班|机场|乘车/.test(name) ? "train" as const : /茶|咖啡|餐|食/.test(name) ? "cup" as const : /酒店|住宿|睡|午休|休息/.test(name) ? "bed" as const : /公园|森林|自然|庭院/.test(name) ? "forest" as const : "compass" as const; }

export function Timeline({ items, onSelect, visuals }: { items: ItineraryItem[]; onSelect: (item: ItineraryItem) => void; visuals?: JourneyVisuals }) {
  return <div className={styles.timeline}>{items.map((item, index) => <button className={styles.stop} key={item.id ?? `${item.date ?? ""}-${item.time}-${index}`} onClick={() => onSelect(item)}><div className={styles.stopTop}><span className={styles.time}>{item.time}</span><Badge tone={item.fixed ? "green" : "muted"}><Icon name={item.fixed ? "lock" : "leaf"} size={12} />{item.fixed ? "固定安排" : "可灵活调整"}</Badge></div><div className={styles.stopBody}><div className={styles.stopIcon}>{item.sourceUrl && productImageUrl(visuals?.images[item.sourceUrl]?.imageUrl) ? <Image src={fliggyImage(visuals!.images[item.sourceUrl].imageUrl, 160) ?? visuals!.images[item.sourceUrl].imageUrl} alt={visuals!.images[item.sourceUrl].name} width={64} height={64} unoptimized loading="lazy" referrerPolicy="no-referrer" style={{ objectFit: "cover", borderRadius: 8 }} onError={event => { event.currentTarget.hidden = true; }} /> : <Icon name={activityIcon(item.name)} size={29} />}<small>{item.fixed ? "保留安排" : "旅程节点"}</small></div><div className={styles.stopCopy}><h4>{item.name}</h4><p>{item.detail}</p><small>查看安排 <Icon name="arrow" size={13} /></small></div></div></button>)}</div>;
}
