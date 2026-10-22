import type { MetadataRoute } from "next";
import { PUBLIC_SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: PUBLIC_SITE_URL,
      changeFrequency: "hourly",
      priority: 1,
    },
    {
      url: `${PUBLIC_SITE_URL}/submit-match`,
      changeFrequency: "monthly",
      priority: 0.4,
    },
  ];
}
