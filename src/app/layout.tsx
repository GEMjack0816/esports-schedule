import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { PUBLIC_SITE_URL } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  title: "赛界 PULSE｜五大电竞赛程聚合",
  description: "聚合英雄联盟、无畏契约、王者荣耀、CS2 与 Dota 2 的主要职业及半职业比赛。",
  metadataBase: new URL(PUBLIC_SITE_URL),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "赛界 PULSE｜全球电竞赛程",
    description: "聚合五大电竞项目的主要职业及半职业比赛、比分与直播入口。",
    url: PUBLIC_SITE_URL,
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
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <script
          dangerouslySetInnerHTML={{
            __html: "try{var t=localStorage.getItem('schedule-theme');document.documentElement.dataset.theme=t==='light'||t==='dark'?t:(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark')}catch(e){document.documentElement.dataset.theme='dark'}",
          }}
        />
        {children}
      </body>
    </html>
  );
}
