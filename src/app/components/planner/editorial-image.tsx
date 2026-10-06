"use client";

import Image from "next/image";
import { useState } from "react";
import { ambienceForContent } from "@/lib/visual-assets";
import { productImageUrl } from "@/lib/product-image";
import styles from "./editorial-image.module.css";

export function EditorialImage({ subject, compact = false, imageUrl, product = false }: { subject: string; compact?: boolean; imageUrl?: string; product?: boolean }) {
  const asset = ambienceForContent(subject);
  const verifiedImage = productImageUrl(imageUrl);
  const src = verifiedImage ?? (product ? "" : compact ? asset.thumbnail : asset.src);
  const [failedSource, setFailedSource] = useState("");
  return <span className={`${styles.image} ${compact ? styles.compact : ""}`}>
    {!src || failedSource === src ? <span className={styles.fallback}>{product ? "暂无可用商品图" : "图片暂不可用"}<br />可继续查看文字与来源</span>
      : <Image src={src} alt={verifiedImage ? `${subject}，飞猪商品图片` : asset.alt} fill unoptimized referrerPolicy="no-referrer" sizes={compact ? "(max-width: 699px) 76vw, 360px" : "(max-width: 699px) 90vw, 640px"} onError={() => setFailedSource(src)} />}
    <span className={styles.caption}>{verifiedImage ? "飞猪商品图 · 以商品页为准" : product ? "商品图片未返回" : "生成氛围图 · 非地点实景"}</span>
  </span>;
}
