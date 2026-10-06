import type { FlyaiSource } from "@/lib/flyai";
import { productImageUrl } from "../product-image";

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Names and URLs are copied together from real FlyAI data, never model output. */
export function extractFlyaiSources(data: unknown, category: string, maximum = 30): FlyaiSource[] {
  const sources = new Map<string, FlyaiSource>();
  const walk = (value: unknown, depth = 0) => {
    if (depth > 12 || sources.size >= maximum) return;
    if (typeof value === "string" && value.length < 2_000_000) {
      try { walk(JSON.parse(value), depth + 1); } catch { /* Plain product text is not JSON. */ }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 50)) walk(item, depth + 1);
      return;
    }
    if (!record(value)) return;
    const link = value.jumpUrl ?? value.detailUrl ?? value.source_url ?? value.sourceUrl ?? value.url ?? value.link;
    const name = value.title ?? value.name ?? value.poiName ?? value.hotelName;
    if (typeof link === "string" && typeof name === "string" && name.trim()) {
      try {
        const url = new URL(link);
        if (url.protocol === "https:" && !url.username && !url.password) {
          const price = typeof value.price === "string" || typeof value.price === "number"
            ? String(value.price).slice(0, 40) : null;
          // Product searches return `picUrl`; attraction and hotel searches return `mainPic`.
          const imageUrl = productImageUrl(value.picUrl ?? value.mainPic ?? value.imageUrl ?? value.image_url);
          const address = typeof value.address === "string" && value.address.trim() ? value.address.trim().slice(0, 160) : null;
          sources.set(url.toString(), { name: name.trim().slice(0, 160), url: url.toString(), category, price,
            ...(imageUrl ? { imageUrl } : {}), ...(address ? { address } : {}) });
        }
      } catch { /* Invalid provider links never become recommendations. */ }
    }
    for (const [key, item] of Object.entries(value).slice(0, 60)) {
      if (!/image|pic|thumbnail|icon|systemMessage|authorization|credential|api.?key/i.test(key)) walk(item, depth + 1);
    }
  };
  walk(data);
  return [...sources.values()];
}
