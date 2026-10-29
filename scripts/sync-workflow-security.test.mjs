import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/sync-schedule.yml", import.meta.url), "utf8");
const syncRunner = readFileSync(new URL("./run-schedule-sync.mjs", import.meta.url), "utf8");
const CHECKOUT_V7_0_1_SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";

describe("production sync workflow security contract", () => {
  it("only exposes scheduled/manual triggers and only runs the job on main", () => {
    const triggerBlock = workflow.match(
      /^on:\r?\n((?:[ \t]+[^\r\n]*\r?\n|[ \t]*\r?\n)*)/m,
    )?.[1];
    const triggers = [...(triggerBlock ?? "").matchAll(/^  ([A-Za-z_][A-Za-z0-9_-]*):/gm)]
      .map((match) => match[1]);

    expect(triggers).toEqual(["schedule", "workflow_dispatch"]);
    expect(workflow).toMatch(
      /^    if: github\.ref == ['"]refs\/heads\/main['"]/m,
    );
  });

  it("uses minimal permissions and does not persist checkout credentials", () => {
    const permissionBlock = workflow.match(
      /^permissions:\r?\n((?:[ \t]+[^\r\n]*\r?\n|[ \t]*\r?\n)*)/m,
    )?.[1];
    const permissions = [...(permissionBlock ?? "").matchAll(/^  ([A-Za-z_][A-Za-z0-9_-]*):\s*(\S+)/gm)]
      .map((match) => [match[1], match[2]]);

    expect(permissions).toEqual([["contents", "read"]]);
    expect(workflow).toContain(`uses: actions/checkout@${CHECKOUT_V7_0_1_SHA} # v7.0.1`);
    expect(workflow).toMatch(/persist-credentials:\s*false/);
    const actionReferences = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)]
      .map((match) => match[1]);
    expect(actionReferences.length).toBeGreaterThan(0);
    expect(actionReferences.every((reference) => /@[0-9a-f]{40}$/.test(reference))).toBe(true);
  });

  it("preserves the 15-minute schedule, non-overlap, and fixed authenticated Production target", () => {
    expect(workflow).toMatch(/cron:\s*["']?\*\/15 \* \* \* \*["']?/);
    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).toMatch(/group:\s*esports-schedule-production-sync/);
    expect(workflow).toMatch(/cancel-in-progress:\s*false/);
    expect(syncRunner).toContain('const SYNC_URL = "https://esports-schedule-two.vercel.app/api/cron/sync";');
    expect(syncRunner).toMatch(/authorization:\s*`Bearer \${secret}`/);
    expect(syncRunner).not.toMatch(/SYNC_URL.*secret|secret.*SYNC_URL/);
  });

  it("keeps CRON_SECRET in the workflow environment, not in a URL or emitted command", () => {
    expect(workflow).toContain("CRON_SECRET: ${{ secrets.CRON_SECRET }}");
    expect(workflow).not.toMatch(/https?:[^\s]*\$\{\{\s*secrets\.CRON_SECRET/);
    expect(workflow).not.toMatch(/echo\s+.*CRON_SECRET/);
    expect(syncRunner).not.toMatch(/console\.(?:log|error).*secret/i);
  });
});
