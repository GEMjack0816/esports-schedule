import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(process.cwd(), ".github/workflows/ci.yml");

describe("CI workflow supply-chain pins", () => {
  it("pins every GitHub Action to a full immutable commit SHA", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const references = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map(
      ([, reference]) => reference,
    );

    expect(references.length).toBeGreaterThan(0);
    expect(references).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^actions\/checkout@[0-9a-f]{40}$/),
        expect.stringMatching(/^actions\/setup-node@[0-9a-f]{40}$/),
      ]),
    );
    expect(references.every((reference) => /^[^@]+@[0-9a-f]{40}$/.test(reference))).toBe(
      true,
    );
  });
});
