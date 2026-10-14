import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const verifierPath = fileURLToPath(new URL("./verify-browser.mjs", import.meta.url));
const sentinel = "client_secret=private-token";

describe("browser verifier target URL validation", () => {
  it("fails closed before browser launch and does not echo a query credential", () => {
    const unsafeUrl = `https://preview.invalid/?${sentinel}`;
    const result = spawnSync(process.execPath, [verifierPath, unsafeUrl], {
      encoding: "utf8",
      timeout: 10_000,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    expect(result.status).toBe(1);
    expect(output).toContain("Browser verification failed; details redacted.");
    expect(output).not.toContain(sentinel);
  });
});
