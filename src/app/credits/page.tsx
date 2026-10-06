import Link from "next/link";
import { DESTINATION_PHOTOS } from "@/lib/visual-assets";

export const metadata = { title: "图片来源与许可 · BioTrip" };
export default function CreditsPage() {
  return <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 24px", lineHeight: 1.8 }}>
    <Link href="/">返回 BioTrip</Link><h1>图片来源与许可</h1>
    <p>目的地实景、商品图与生成氛围图各有来源，不互相替代。实景照片记录拍摄当天的地点，不代表当前天气、开放状态或商品内容。</p>
    <h2>实景照片</h2>{DESTINATION_PHOTOS.map(photo => <section key={photo.id}>
      <h3>{photo.location}</h3><p>摄影：{photo.author} · 拍摄日期：{photo.capturedAt} · {photo.license}</p>
      <p><a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer">原始作品与作者许可声明 ↗</a> · <a href={photo.licenseUrl} target="_blank" rel="noopener noreferrer">CC0 许可说明 ↗</a></p>
      <p>交付图片按原比例缩小并编码为 WebP，未改变画面内容。已归档原图、许可页面、版本与文件指纹。网页、公开分享和海报保留来源标注；摄影者不为 BioTrip 或商品背书。</p>
    </section>)}
    <h2>飞猪实景与商品图</h2><p>从同一条飞猪 API 记录读取地点或商品名称、图片及来源链接，用于对应旅程封面、活动与商品卡片。公开网页只展示发布者明确选定的图片，下载海报继续使用手记封面。图片直接从提供方 CDN 展示，不转存为本站公共图库；来源为地点或商品提供方。API 返回图片地址不代表公有领域或独立转载许可。</p>
    <h2>生成氛围图</h2><p>庭院、森林、茶、海岸、休息与列车六组图片在项目中声明来源为 OpenAI 图像生成，均标注为生成氛围图。文件指纹已归档，历史生成回执未归档；该声明不作为第三方照片授权证明。</p>
    <p><a href="https://openai.com/policies/row-terms-of-use/" target="_blank" rel="noopener noreferrer">OpenAI 服务条款 ↗</a>。使用仍须遵守适用条款与第三方权利，不宣称图片真实反映某家商户。</p>
    <h2>字体</h2><p>Plus Jakarta Sans 随项目附 SIL Open Font License；中文优先使用设备系统字体。</p>
    <p><a href="/fonts/LICENSE-jakarta.txt">查看字体许可</a></p><small>来源核查：2026-10-04</small>
  </main>;
}
