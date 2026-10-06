"use client";
import Image from "next/image";
import { useState } from "react";
import type { VisualRef } from "@/lib/journey-types";
import { fliggyImage, productImageUrl } from "@/lib/product-image";
import css from "./journey-cover.module.css";

/** Only the bound server catalogue supplies real photographs. */
export function JourneyCover({ images, fallback, alt, compact = false }: { images?: VisualRef[]; fallback: string; alt: string; compact?: boolean }) {
  const [failed, setFailed] = useState<string[]>([]);
  const verified = (images ?? []).filter(image => productImageUrl(image.imageUrl) && !failed.includes(image.imageUrl));
  const shown = compact ? verified.slice(0, 4) : verified.slice(0, 1);
  return <div className={`${css.cover} ${compact ? css.grid : ""}`} aria-label={alt}>
    {shown.length ? shown.map(image => <Image key={image.imageUrl} src={fliggyImage(image.imageUrl, compact ? 200 : 1000, compact ? 200 : 650) ?? image.imageUrl} alt={image.name} width={compact ? 200 : 1000} height={compact ? 200 : 650} unoptimized loading={compact ? "lazy" : "eager"} referrerPolicy="no-referrer" onError={() => setFailed(current => [...current, image.imageUrl])} />)
      : <Image src={fallback} alt={alt} width={1000} height={650} unoptimized loading={compact ? "lazy" : "eager"} />}
    {!compact && shown.length > 0 && <span className={css.credit}>{shown.length ? `${shown[0].kind === "poi" ? "飞猪实景" : "飞猪商品图片"} · 以页面为准` : "授权实景 / 氛围图 · 来源见图片说明"}</span>}
  </div>;
}
