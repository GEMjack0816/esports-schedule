import { describe, expect, it } from "vitest";
import { getRobots } from "./robots";
import sitemap from "./sitemap";
import { PUBLIC_SITE_URL } from "@/lib/site";

describe("public crawler metadata", () => {
  it("allows public pages and disallows administrator and API routes", () => {
    const result = getRobots("production");
    const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;

    expect(rules).toMatchObject({ userAgent: "*", allow: "/" });
    expect(rules.disallow).toEqual(expect.arrayContaining(["/admin", "/api"]));
    expect(result.sitemap).toBe(`${PUBLIC_SITE_URL}/sitemap.xml`);
  });

  it.each(["preview", "development", undefined])("prevents indexing outside production (%s)", (environment) => {
    const result = getRobots(environment);
    const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;

    expect(rules).toMatchObject({ userAgent: "*", disallow: "/" });
    expect(result.sitemap).toBeUndefined();
  });

  it("lists only stable public page URLs on the canonical HTTPS origin", () => {
    const entries = sitemap();

    expect(entries.map((entry) => entry.url)).toEqual([
      PUBLIC_SITE_URL,
      `${PUBLIC_SITE_URL}/submit-match`,
    ]);
    for (const { url } of entries) {
      expect(new URL(url).origin).toBe(PUBLIC_SITE_URL);
      expect(url).not.toContain("/admin");
      expect(url).not.toContain("/api/");
    }
  });
});
