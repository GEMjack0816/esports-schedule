import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { siteMetadataBase, socialImageAlt, socialImagePath, socialImageUrl, twitterCard } from "./site-social-metadata";

describe("site social metadata", () => {
  it("uses a large image card with stable public metadata", () => {
    expect(twitterCard.card).toBe("summary_large_image");
    expect(twitterCard.title).toContain("赛界 PULSE");
    expect(socialImageUrl).toBe(new URL(socialImagePath, siteMetadataBase).toString());
    expect(twitterCard.images).toEqual([socialImageUrl]);
    expect(socialImageAlt).toContain("五大电竞赛事");
  });

  it("ships a valid 1200x630 PNG social card under the standard size limit", async () => {
    const image = await readFile(new URL(`../../public${socialImagePath}`, import.meta.url));

    expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(image.readUInt32BE(16)).toBe(1200);
    expect(image.readUInt32BE(20)).toBe(630);
    expect(image.byteLength).toBeLessThan(5 * 1024 * 1024);
  });
});
