import { describe, expect, it } from "vitest";
import { runtimeCacheScope } from "./cache";

describe("schedule Runtime Cache scope", () => {
  it("preserves the existing Production cache keys", () => {
    expect(runtimeCacheScope("production", "main", "production-sha")).toBe("");
  });

  it("isolates Preview branches", () => {
    expect(runtimeCacheScope("preview", "fix/one", "same-sha"))
      .not.toBe(runtimeCacheScope("preview", "fix/two", "same-sha"));
  });

  it("falls back to the deployment SHA when a Preview ref is unavailable", () => {
    expect(runtimeCacheScope("preview", undefined, "preview-sha"))
      .toBe("preview:preview-sha:");
  });
});
