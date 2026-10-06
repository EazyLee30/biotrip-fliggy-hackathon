/** Decorative imagery must never be presented as a photograph of a real venue. */
export const COURTYARD_ASSET = {
  id: "morning-courtyard", type: "generated_ambience", location: null,
  source: "OpenAI image generation", author: "BioTrip", license: "Generated for BioTrip",
  alt: "晨光下的浅色庭院、树影与木凳，生成的旅行氛围图",
  src: "/ambience/courtyard-1280.webp", thumbnail: "/ambience/courtyard-640.webp",
  focalPoint: "65% 55%", dominantColor: "#eae2d5", uses: ["journey", "profile", "share"],
} as const;

export const AMBIENCE_ASSETS = [COURTYARD_ASSET, ...([
  ["forest", "晨光中的自然步道"], ["tea", "窗边的茶与木桌"], ["coast", "平静海岸与草地"],
  ["rest", "窗边的休息角落"], ["train", "列车窗外的绿色乡野"],
] as const).map(([id, alt]) => ({ id, type: "generated_ambience" as const, location: null,
  source: "OpenAI image generation", author: "BioTrip", license: "Generated for BioTrip",
  alt: `${alt}，生成的旅行氛围图`, src: `/ambience/${id}-1280.webp`, thumbnail: `/ambience/${id}-640.webp`,
  focalPoint: "65% 55%", dominantColor: "#eae2d5", uses: ["rhythm", "discovery"] }))];

/** Match an illustrative theme, never claim it depicts the named venue. */
export function ambienceForContent(text: string) {
  const id = /交通|航班|车站|列车|地铁|接送/.test(text) ? "train"
    : /住宿|酒店|睡眠|午休|温泉|按摩/.test(text) ? "rest"
    : /海岸|海边|沙滩|海岛/.test(text) ? "coast"
    : /森林|公园|湿地|步道|自然|山/.test(text) ? "forest"
    : /餐|美食|茶|咖啡|品茗/.test(text) ? "tea"
    : "morning-courtyard";
  return AMBIENCE_ASSETS.find((asset) => asset.id === id) ?? COURTYARD_ASSET;
}

/** Archived assets retained only to render already-published share snapshots. */
export const DESTINATION_PHOTOS = [{
  id: "hangzhou-broken-bridge" as const, type: "destination_photo" as const, location: "杭州西湖断桥", destination: "杭州",
  source: "Wikimedia Commons", author: "Suicasmo", license: "CC0-1.0", capturedAt: "2025-05-05",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Broken_Bridge_(Hangzhou)_20250505.jpg",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  alt: "杭州西湖断桥实景，Suicasmo 于 2025 年 5 月 5 日拍摄",
  src: "/destinations/hangzhou-broken-bridge-1280.webp", thumbnail: "/destinations/hangzhou-broken-bridge-640.webp",
  focalPoint: "50% 50%", dominantColor: "#d7e4e1", uses: ["journey", "share"],
}];
export const SHARE_ASSETS = [...AMBIENCE_ASSETS, ...DESTINATION_PHOTOS];
/** New covers use the light editorial ambience collection. */
export const SELECTABLE_SHARE_ASSETS = AMBIENCE_ASSETS;
export function coverForDestination() {
  return COURTYARD_ASSET;
}
export function shareCoverAsset(id?: string) { return SHARE_ASSETS.find(asset => asset.id === id) ?? COURTYARD_ASSET; }
export function coverCaption(asset: typeof SHARE_ASSETS[number]) {
  return asset.type === "destination_photo" ? `杭州断桥 · ${asset.author} · CC0 · ${asset.capturedAt}` : "生成的旅行氛围图";
}
