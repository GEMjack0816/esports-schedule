import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const verifierPath = fileURLToPath(new URL("./verify-production.mjs", import.meta.url));
const sentinel = "sensitive://user:password@private.invalid/path?token=do-not-log";

function runVerifierWithFailure(mode) {
  const harness = `
    import { pathToFileURL } from "node:url";
    const sensitive = ${JSON.stringify(sentinel)};
    if (${JSON.stringify(mode)} === "fetch") {
      globalThis.fetch = async () => {
        const error = new Error(sensitive);
        error.name = sensitive;
        throw error;
      };
    } else {
      globalThis.fetch = async () => ({
        headers: { get: () => null },
        text: async () => "",
        json: async () => ({}),
        get status() { throw new Error(sensitive); },
      });
    }
    process.argv = [process.execPath, ${JSON.stringify(verifierPath)}, "https://preview.invalid", "abc123"];
    await import(pathToFileURL(${JSON.stringify(verifierPath)}).href);
  `;

  return spawnSync(process.execPath, ["--input-type=module", "-e", harness], {
    encoding: "utf8",
    timeout: 10_000,
  });
}

describe("production verifier error redaction", () => {
  it.each(["fetch", "response"])("does not print sensitive error details from %s failures", (mode) => {
    const result = runVerifierWithFailure(mode);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    expect(result.status).toBe(1);
    expect(output).toContain("FAIL verification request — details redacted.");
    expect(output).not.toContain(sentinel);
  });
});
