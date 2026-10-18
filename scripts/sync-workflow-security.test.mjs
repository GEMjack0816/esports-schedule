import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/sync-schedule.yml", import.meta.url), "utf8");

describe("production sync workflow security contract", () => {
  it("pins checkout to a full commit SHA and does not persist its token", () => {
    expect(workflow).toMatch(/uses:\s*actions\/checkout@[0-9a-f]{40}\s+# v7\.0\.1/);

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
