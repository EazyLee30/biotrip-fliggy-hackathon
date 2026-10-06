import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ServiceWorkerRegister } from "./components/service-worker-register";
import "./globals.css";
import "./fonts.css";

export const metadata: Metadata = {
  applicationName: "BioTrip",
  title: "BioTrip — 让行程更适合今天",
  description: "根据身体状态，温和调整旅行节奏。每一处改变，都由你确认。",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "BioTrip",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: "/biotrip-icon.svg",
    apple: "/biotrip-icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#f7f6f1",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
