import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(process.cwd(), ".github/workflows/dependency-audit.yml");

describe("scheduled dependency audit workflow", () => {
  const workflow = readFileSync(workflowPath, "utf8");

  it("runs on a weekly schedule, manually, and when dependency files change", () => {
    expect(workflow).toMatch(/schedule:\s*\r?\n\s*- cron: "17 8 \* \* 1"/);
    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).toMatch(/pull_request:[\s\S]*?package\.json[\s\S]*?package-lock\.json/);
  });

  it("uses read-only permissions and immutable, credential-free actions", () => {
    expect(workflow).toMatch(/permissions:\s*\r?\n\s+contents: read/);
    const references = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map(([, ref]) => ref);
    expect(references).toEqual([
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1",
    ]);
    expect(workflow).toMatch(/persist-credentials: false/);
  });

  it("audits the locked dependency tree without exposing repository secrets", () => {
    expect(workflow).toMatch(/run: npm ci/);
    expect(workflow).toMatch(/run: npm audit/);
    expect(workflow).not.toMatch(/secrets\./i);
  });
});
