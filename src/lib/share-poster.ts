import type { JourneyShareSnapshot } from "./journey-share";
import { shareCoverAsset, coverCaption } from "./visual-assets";

type Line = { text: string; size: number; color: string; gap: number };
export type PosterPage = { blob: Blob; filename: string };
const WIDTH = 1080, PAD = 84, BODY_WIDTH = WIDTH - PAD * 2;
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  return text.split(/\r?\n/).flatMap((paragraph) => {
    const lines: string[] = []; let line = "";
    for (const character of paragraph) { if (line && ctx.measureText(line + character).width > width) { lines.push(line); line = ""; } line += character; }
    return [...lines, line];
  });
}
function font(size: number) { return `${size >= 46 ? "500" : "400"} ${size}px ${size >= 46 ? '"Songti SC", "Noto Serif SC", serif' : '"PingFang SC", "Microsoft YaHei", sans-serif'}`; }
function paintBase(ctx: CanvasRenderingContext2D, height: number, title: string, page: number) {
  ctx.fillStyle = "#f7f6f1"; ctx.fillRect(0, 0, WIDTH, height);
  ctx.font = font(30); ctx.fillStyle = "#2f6654"; ctx.fillText("BioTrip · 旅行札记", PAD, 68);
  ctx.font = font(48); ctx.fillStyle = "#273830"; ctx.fillText(title, PAD, 148);
  ctx.font = font(24); ctx.fillStyle = "#637166"; ctx.fillText(`留一点时间，给旅途。 · ${page}`, PAD, height - 42);
}
async function finish(canvas: HTMLCanvasElement): Promise<Blob> {
  try { return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("海报保存失败，请重试。")), "image/png")); }
  finally { canvas.width = 1; canvas.height = 1; }
}

/** Uses only the immutable snapshot approved by the publisher, never the private journey. */
export async function createSharePosters(snapshot: JourneyShareSnapshot, url: string): Promise<PosterPage[]> {
  await document.fonts.ready;
  const QRCode = (await import("qrcode")).default;
  const coverAsset = shareCoverAsset(snapshot.coverAssetId);
  const image = new Image(); image.src = coverAsset.src;
  await image.decode();
  const qr = document.createElement("canvas");
  await QRCode.toCanvas(qr, url, { width: 160, margin: 1, color: { dark: "#273830", light: "#fffefa" } });
  const layout = document.createElement("canvas"); const measure = layout.getContext("2d");
  if (!measure) throw new Error("当前浏览器无法绘制海报。");
  if (snapshot.template === "postcard") {
    const canvas = document.createElement("canvas"); canvas.width = WIDTH; canvas.height = 1440;
    const context = canvas.getContext("2d"); if (!context) throw new Error("当前浏览器无法绘制海报。");
    paintBase(context, 1440, `${snapshot.destination} · 旅行明信片`, 1);
    context.save(); context.beginPath(); context.rect(0, 220, WIDTH, 540); context.clip();
    const scale = Math.max(WIDTH / image.width, 540 / image.height);
    context.drawImage(image, (WIDTH - image.width * scale) / 2, 220 + (540 - image.height * scale) / 2, image.width * scale, image.height * scale); context.restore();
    context.font = font(22); context.fillStyle = "#637166"; context.fillText(coverCaption(coverAsset), PAD, 797);
    context.font = font(48); context.fillStyle = "#273830";
    const heading = wrap(context, snapshot.headline, BODY_WIDTH);
    if (heading.length > 3) throw new Error("标题过长，请缩短分享标题。");
    heading.forEach((line, index) => context.fillText(line, PAD, 860 + index * 60));
    snapshot.places.forEach((place, index) => {
      context.font = font(30); context.fillStyle = "#273830"; context.fillText(place.name, PAD, 1050 + index * 86);
      context.font = font(22); context.fillStyle = "#637166"; context.fillText(`${place.category} · ${place.source}`, PAD, 1081 + index * 86, 690);
    });
    context.drawImage(qr, WIDTH - PAD - 160, 1170);
    context.font = font(22); context.fillStyle = "#637166"; context.fillText("扫码查看推荐来源", WIDTH - PAD - 175, 1360);
    qr.width = 1; qr.height = 1; layout.width = 1; layout.height = 1;
    return [{ blob: await finish(canvas), filename: "BioTrip-旅行明信片.png" }];
  }
  const lines: Line[] = [];
  function paragraph(text: string, size = 30, gap = 12, color = "#637166") {
    if (!text) return;
    measure!.font = font(size);
    const parts = wrap(measure!, text, BODY_WIDTH);
    for (let index = 0; index < parts.length; index++) lines.push({ text: parts[index], size, color, gap: index === parts.length - 1 ? gap : 0 });
  }
  paragraph(snapshot.summary, 30, 28);
  const legacyDates = [...new Set(snapshot.itinerary?.map((item) => item.date ?? "") ?? [])];
  const days = snapshot.days ?? legacyDates.map((date, index) => ({ dayIndex: index + 1,
    ...(date ? { date } : {}), items: snapshot.itinerary!.filter((item) => (item.date ?? "") === date) }));
  for (const day of days) {
    paragraph(`第 ${day.dayIndex} 天${"date" in day && day.date ? ` · ${day.date}` : ""}`, 46, 18, "#2f6654");
    for (const item of day.items) {
      paragraph(`${item.time}  ${item.name}${item.fixed ? " · 固定安排" : ""}`, 34, 8, "#273830");
      paragraph(item.detail ?? "", 28, 18);
    }
  }
  if (snapshot.places.length) {
    paragraph("沿途值得停留", 46, 18, "#2f6654");
    for (const place of snapshot.places) { paragraph(place.name, 34, 6, "#273830"); paragraph(`${place.category} · ${place.source}`, 26, 14); }
  }
  const pages: Line[][] = []; let current: Line[] = [], used = 0;
  for (const line of lines) {
    const height = Math.ceil(line.size * 1.65) + line.gap;
    if (current.length && used + height > 1260) { pages.push(current); current = []; used = 0; }
    current.push(line); used += height;
  }
  if (current.length) pages.push(current);
  if (pages.length > 5) throw new Error("公开内容超过 6 张海报，请减少活动说明或仅分享链接。内容没有被截断。");
  const output: PosterPage[] = [];
  const cover = document.createElement("canvas"); cover.width = WIDTH; cover.height = 1440;
  const ctx = cover.getContext("2d"); if (!ctx) throw new Error("当前浏览器无法绘制海报。");
  paintBase(ctx, 1440, "一段属于自己的旅行", 1);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 220, WIDTH, 740); ctx.clip();
  const scale = Math.max(WIDTH / image.width, 740 / image.height);
  ctx.drawImage(image, (WIDTH - image.width * scale) / 2, 220, image.width * scale, image.height * scale); ctx.restore();
  ctx.font = font(24); ctx.fillStyle = "#637166"; ctx.fillText(coverCaption(coverAsset), PAD, 1000);
  ctx.font = font(52); ctx.fillStyle = "#273830";
  const heading = wrap(ctx, snapshot.headline, 700);
  if (heading.length > 3) throw new Error("旅程标题过长，请使用较短的分享标题。");
  heading.forEach((line, index) => ctx.fillText(line, PAD, 1090 + index * 80));
  ctx.drawImage(qr, WIDTH - PAD - 160, 1170);
  ctx.font = font(22); ctx.fillStyle = "#637166"; ctx.fillText("扫码打开旅行手记", WIDTH - PAD - 175, 1360);
  output.push({ blob: await finish(cover), filename: "BioTrip-旅行札记-1.png" });
  for (let index = 0; index < pages.length; index++) {
    const canvas = document.createElement("canvas"); canvas.width = WIDTH; canvas.height = 1920;
    const context = canvas.getContext("2d"); if (!context) throw new Error("当前浏览器无法绘制海报。");
    paintBase(context, 1920, "旅行手记", index + 2);
    context.font = font(40); context.fillStyle = "#273830";
    const titleLines = wrap(context, snapshot.headline, BODY_WIDTH);
    titleLines.forEach((line, titleIndex) => context.fillText(line, PAD, 200 + titleIndex * 55));
    let y = 240 + titleLines.length * 55;
    for (const line of pages[index]) { context.font = font(line.size); context.fillStyle = line.color; context.fillText(line.text, PAD, y); y += Math.ceil(line.size * 1.65) + line.gap; }
    context.drawImage(qr, WIDTH - PAD - 160, 1690);
    output.push({ blob: await finish(canvas), filename: `BioTrip-旅行札记-${index + 2}.png` });
  }
  qr.width = 1; qr.height = 1; layout.width = 1; layout.height = 1;
  return output;
}
