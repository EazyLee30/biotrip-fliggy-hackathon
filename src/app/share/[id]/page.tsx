import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { readActiveShare } from "@/lib/public-share";
import { shareCoverAsset, coverCaption } from "@/lib/visual-assets";
import { SharePosterPanel } from "@/app/components/planner/share-poster-panel";
import { PublicVisuals } from "@/app/components/planner/public-visuals";
import { ShareActions } from "./share-actions";
import "./share.css";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const share = await readActiveShare(id).catch(() => null);
  const title = share ? `${share.headline} · BioTrip` : "分享暂不可用 · BioTrip";
  const cover = shareCoverAsset(share?.coverAssetId);
  return { title, description: "一段从容的旅行手记。", robots: { index: false, follow: false },
    openGraph: { title, description: "一段从容的旅行手记。", images: [{ url: `https://biotrip.ccwu.cc${cover.src}`, width: 1280, height: 720 }] } };
}
export default async function SharedTripPage({ params }: Props) {
  const { id } = await params;
  const result = await readActiveShare(id).then((share) => ({ share, error: "" })).catch(() => ({ share: null, error: "分享页面暂时无法打开，请稍后重试。" }));
  const { share } = result;
  if (!share && !result.error) notFound();
  const cover = shareCoverAsset(share?.coverAssetId);
  const error = result.error || (!share ? "分享页面不存在、已撤回或已过期。" : "");
  return <main className="zen-share-page"><header className="zen-share-header"><Link className="zen-share-brand" href="/">BioTrip <span>让旅程跟随你的节奏</span></Link><Link href="/login">规划我的旅程 ↗</Link></header><article className={`zen-share-card ${share?.template === "postcard" ? "zen-share-postcard" : ""}`}>
    <div className="zen-share-cover" style={{ backgroundImage: `url(${cover.src})` }}><small>{share?.template === "postcard" ? "旅行明信片" : "旅行手记"} · BioTrip</small><h1>{share?.headline || "分享暂不可用"}</h1><span>{coverCaption(cover)}</span></div>
    {share ? <div className="zen-share-body"><div className="zen-share-destination">{share.destination} · 慢慢走，好好感受。</div>{share.summary ? <p className="zen-share-summary">{share.summary}</p> : null}
      <PublicVisuals images={share.coverImages} />
      {share.days?.map((day) => <section className="zen-share-itinerary" key={day.dayIndex}><h2>第 {day.dayIndex} 天{day.date ? ` · ${day.date}` : ""}</h2>{day.items.map((item, index) => <div key={index}><small>{item.time}{item.fixed ? " · 固定安排" : ""}</small><h3>{item.name}</h3>{item.detail ? <p>{item.detail}</p> : null}</div>)}</section>)}
      {share.itinerary?.length ? <section className="zen-share-itinerary"><h2>每天的安排</h2>{share.itinerary.map((item, index) => <div key={index}><small>{item.date} · {item.time}{item.fixed ? " · 固定安排" : ""}</small><h3>{item.name}</h3><p>{item.detail}</p></div>)}</section> : null}
      {share.places.length ? <section className="zen-share-places"><h2>沿途值得停留</h2>{share.places.map((place) => <a key={`${place.url}-${place.name}`} href={place.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><span>{place.category}</span><strong>{place.name} ↗</strong></a>)}</section> : null}
      <div className="zen-share-safety">发布者确认公开的旅行手记。{share.journeyVersion ? `对应行程版本 ${share.journeyVersion}，内容保持发布时的快照。` : ""}链接可撤回，90 天后失效；营业时间、价格及预订以服务方为准。</div><ShareActions title={share.headline} /><SharePosterPanel snapshot={share} /></div> : <div className="zen-share-body zen-share-expired" role="status">{error}</div>}
    </article><footer className="zen-share-footer">BioTrip · 留一点时间，给旅途。 <Link href="/credits">图片来源与许可</Link></footer></main>;
}
