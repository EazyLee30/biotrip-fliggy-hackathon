"use client";
import Image from "next/image";
import { useState } from "react";
import type { VisualRef } from "@/lib/journey-types";
import { fliggyImage, productImageUrl } from "@/lib/product-image";
import css from "./public-visuals.module.css";

export function PublicVisuals({ images }: { images?: VisualRef[] }) {
  const [failed, setFailed] = useState<string[]>([]);
  const visible = (images ?? []).filter(image => productImageUrl(image.imageUrl) && !failed.includes(image.imageUrl)).slice(0, 4);
  if (!visible.length) return null;
  return <section className={css.gallery} aria-label="发布者选择公开的目的地图片">
    {visible.map(image => <figure key={image.url}>
      <Image src={fliggyImage(image.imageUrl, 600, 400) ?? image.imageUrl} alt={image.name} width={600} height={400} unoptimized loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(current => [...current, image.imageUrl])} />
      <figcaption>{image.name} · {image.kind === "poi" ? "飞猪实景" : "飞猪商品图片"}</figcaption>
    </figure>)}
  </section>;
}
