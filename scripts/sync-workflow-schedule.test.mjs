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
});
