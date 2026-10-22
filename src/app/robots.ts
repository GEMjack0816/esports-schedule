import type { MetadataRoute } from "next";
import { PUBLIC_SITE_URL } from "@/lib/site";

export function getRobots(environment: string | undefined): MetadataRoute.Robots {
  if (environment !== "production") {
    return {
      rules: {
        userAgent: "*",
        disallow: "/",
      },
    };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api"],
    },
    sitemap: `${PUBLIC_SITE_URL}/sitemap.xml`,
  };
}

export default function robots(): MetadataRoute.Robots {
  return getRobots(process.env.VERCEL_ENV);
}
