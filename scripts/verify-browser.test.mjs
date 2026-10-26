import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(new URL("./verify-browser.mjs", import.meta.url));

describe("verify-browser trusted-source target guard", () => {
  it("rejects an untrusted URL before browser startup and redacts the token", () => {
    const token = "unit-test-trusted-source-token";
    const result = spawnSync(process.execPath, [scriptPath, "https://attacker.example/"], {
      encoding: "utf8",
      env: { ...process.env, VERCEL_OIDC_TOKEN: token },
    });

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("VERCEL_OIDC_TOKEN only supports this project's HTTPS Vercel Preview deployment URL.");
    expect(result.stdout).not.toContain(token);
    expect(result.stderr).not.toContain(token);
  });
});
