import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "BioTrip · 让行程更适合今天",
    short_name: "BioTrip",
    description: "根据身体状态，温和调整旅行节奏。每一处改变，都由你确认。",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: "#f9f9ff",
    theme_color: "#f9f9ff",
    lang: "zh-CN",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/biotrip-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
