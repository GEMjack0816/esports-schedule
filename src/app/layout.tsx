import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "赛界 PULSE｜全球电竞赛程",
  description: "聚合英雄联盟、无畏契约、王者荣耀、CS2 与 Dota 2 的比赛时间、比分和直播入口。",
  metadataBase: new URL("https://esports-schedule.vercel.app"),
  openGraph: {
    title: "赛界 PULSE｜全球电竞赛程",
    description: "五大热门电竞项目赛程、比分与直播，一屏掌握。",
    type: "website",
    locale: "zh_CN",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
