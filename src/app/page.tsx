import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LandingPage } from "./components/landing/landing-page";

export const metadata: Metadata = {
  title: "BioTrip — 让旅途，照顾好今天的你",
  description: "听见身体的声音，让旅行跟随你的节奏。BioTrip 将身体感受、可选的 WHOOP 记录与 AI 旅行规划连在一起，从调整行程到记录反馈，陪你找到更舒服的旅行方式。",
  alternates: { canonical: "https://biotrip.eazylee.si" },
  openGraph: {
    title: "BioTrip — 让旅途，照顾好今天的你",
    description: "一段懂得留白的旅程。从身体感受出发，让行程与你一起变化。",
    url: "https://biotrip.eazylee.si", siteName: "BioTrip", locale: "zh_CN", type: "website",
    images: [{ url: "https://biotrip.eazylee.si/landing/film-poster.webp", width: 1920, height: 1080, alt: "BioTrip 产品影片" }],
  },
};

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  // Preserve journey links and provider callbacks created before the product homepage.
  if (["journey", "view", "whoop"].some((key) => params[key] !== undefined)) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
    }
    redirect(`/app?${query.toString()}`);
  }
  return <LandingPage />;
}
