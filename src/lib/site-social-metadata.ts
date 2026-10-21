import type { Metadata } from "next";

export const siteOrigin = "https://esports-schedule-two.vercel.app";
export const siteMetadataBase = new URL(siteOrigin);
export const socialImagePath = "/esports-schedule-og.png";
export const socialImageUrl = new URL(socialImagePath, siteMetadataBase).toString();
export const socialImageAlt = "赛界 PULSE：聚合五大电竞赛事，赛程、比分与直播一屏掌握";

export const twitterCard = {
  card: "summary_large_image",
  title: "赛界 PULSE｜五大电竞赛程聚合",
  description: "聚合英雄联盟、无畏契约、王者荣耀、CS2 与 Dota 2 的主要职业及半职业比赛。",
  images: [socialImageUrl],
} satisfies NonNullable<Metadata["twitter"]>;
