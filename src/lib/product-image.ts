/** Only public Alibaba image-CDN URLs returned alongside a product are accepted. */
export function productImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    if (!["img.alicdn.com", "gw.alicdn.com"].includes(url.hostname)) return null;
    if ([...url.searchParams.keys()].some((key) => /token|secret|key|authorization|credential|password/i.test(key))) return null;
    return url.href;
  } catch { return null; }
}

/**
 * A resized rendition from the same CDN object. The image CDN serves
 * `<original>_<w>x<h>q<quality>.jpg` for JPEG and PNG originals, which turns a
 * ~100 KB product photo into ~12 KB for a thumbnail. Addresses that already
 * carry a size, or are not a plain JPEG/PNG path, are returned unchanged, and
 * callers keep the original as their load-error fallback.
 */
export function fliggyImage(value: unknown, width: number, height = width, quality = 75): string | null {
  const verified = productImageUrl(value);
  if (!verified) return null;
  const url = new URL(verified);
  if (!/\.(?:jpe?g|png)$/i.test(url.pathname) || /_\d+x\d+/.test(url.pathname)) return verified;
  const size = (edge: number) => Math.max(40, Math.min(2000, Math.round(edge)));
  url.pathname += `_${size(width)}x${size(height)}q${Math.max(20, Math.min(90, Math.round(quality)))}.jpg`;
  return url.href;
}

/** A few hundred bytes of the same photograph, shown blurred while the real rendition loads. */
export function fliggyPlaceholder(value: unknown): string | null {
  return fliggyImage(value, 60, 60, 30);
}
