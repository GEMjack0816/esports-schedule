import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/sync-schedule.yml", import.meta.url), "utf8");
const CHECKOUT_V7_0_1_SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";

describe("production sync workflow security contract", () => {
  it("only runs on its schedule or explicit manual dispatch", () => {
    const triggerBlock = workflow.match(
      /^on:\r?\n((?:[ \t]+[^\r\n]*\r?\n|[ \t]*\r?\n)*)/m,
    )?.[1];
    const triggers = [...(triggerBlock ?? "").matchAll(/^  ([A-Za-z_][A-Za-z0-9_-]*):/gm)].map(
      (match) => match[1],
    );

    expect(triggers).toEqual(["schedule", "workflow_dispatch"]);
    const refreshJob = workflow.match(
      /^  refresh:\r?\n((?:    [^\r\n]*\r?\n|[ \t]*\r?\n)*)/m,
    )?.[1];
    expect(refreshJob).toMatch(/\bif:\s*github\.ref\s*==\s*['"]refs\/heads\/main['"]/);
    const permissionBlock = workflow.match(
      /^permissions:\r?\n((?:[ \t]+[^\r\n]*\r?\n|[ \t]*\r?\n)*)/m,
    )?.[1];
    const permissions = [...(permissionBlock ?? "").matchAll(/^  ([A-Za-z_][A-Za-z0-9_-]*):\s*(\S+)/gm)]
      .map((match) => [match[1], match[2]]);
    expect(permissions).toEqual([["contents", "read"]]);
  });

  it("pins checkout to a full commit SHA and does not persist its token", () => {
    expect(workflow).toContain(`uses: actions/checkout@${CHECKOUT_V7_0_1_SHA} # v7.0.1`);

    const actionReferences = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map(
      (match) => match[1],
    );
    expect(actionReferences.length).toBeGreaterThan(0);
    expect(actionReferences.every((reference) => /@[0-9a-f]{40}$/.test(reference))).toBe(true);

    const checkoutStep = workflow.match(
      /- name: Check out response validator([\s\S]*?)(?=\n      - name:|$)/,
    )?.[1];
    expect(checkoutStep).toMatch(/persist-credentials:\s*false/);
  });

  it("keeps the established schedule and authenticated sync request unchanged", () => {
    expect(workflow).toMatch(/cron:\s*["']?\*\/15 \* \* \* \*["']?/);
    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).toMatch(/SYNC_URL:\s*https:\/\/esports-schedule-two\.vercel\.app\/api\/cron\/sync/);
    expect(workflow).toMatch(/Authorization: Bearer \$CRON_SECRET/);
  });
});
