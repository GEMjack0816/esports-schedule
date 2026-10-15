import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.github/workflows/sync-schedule.yml",
);

describe("fixture sync workflow schedule", () => {
  it("runs every 15 minutes without scheduling at the high-load top of the hour", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const matches = [...workflow.matchAll(/^\s*- cron:\s*["']([^"']+)["']\s*$/gm)];

    expect(matches).toHaveLength(1);

    const fields = matches[0][1].trim().split(/\s+/);
    expect(fields).toHaveLength(5);
    expect(fields.slice(1)).toEqual(["*", "*", "*", "*"]);

    const minutes = fields[0].split(",").map(Number);
    expect(minutes.every(Number.isInteger)).toBe(true);
    expect(minutes).toHaveLength(4);
    expect(minutes).not.toContain(0);
    expect(minutes.every((minute) => minute >= 0 && minute < 60)).toBe(true);

    const sortedMinutes = [...minutes].sort((a, b) => a - b);
    for (let index = 0; index < sortedMinutes.length; index += 1) {
      const current = sortedMinutes[index];
      const next = sortedMinutes[(index + 1) % sortedMinutes.length];
      const gap = (next - current + 60) % 60;
      expect(gap).toBe(15);
    }
  });

  it("keeps authenticated sync dispatch serialized and validates its structured result", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toMatch(/^  workflow_dispatch:\s*$/m);
    expect(workflow).toMatch(/^concurrency:\s*$/m);
    expect(workflow).toMatch(/^  group: esports-schedule-production-sync\s*$/m);
    expect(workflow).toMatch(/^  cancel-in-progress: false\s*$/m);

    // The credential must come from Actions Secrets and travel only as an
    // Authorization header; never put it in the request URL or query string.
    expect(workflow).toContain("CRON_SECRET: ${{ secrets.CRON_SECRET }}");
    expect(workflow).toContain("SYNC_URL: https://esports-schedule-two.vercel.app/api/cron/sync");
    expect(workflow).toMatch(/--header\s+"Authorization: Bearer \$CRON_SECRET"/);
    expect(workflow).not.toMatch(/(?:SYNC_URL|url|query)\s*[:=].*(?:secrets\.CRON_SECRET|Bearer)/i);

    // A successful HTTP status alone is insufficient: the JSON contract
    // validator must decide whether the sync itself succeeded.
    expect(workflow).toMatch(/node scripts\/validate-sync-response\.mjs "\$response_file" "\$http_status"/);
  });
});
