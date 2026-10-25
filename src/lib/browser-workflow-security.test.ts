import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/browser-regression.yml", import.meta.url),
  "utf8",
);

describe("browser regression workflow supply-chain safeguards", () => {
  it("pins every action to an immutable commit SHA", () => {
    const actions = [...workflow.matchAll(/^\s+uses:\s*([^\s#]+)/gm)]
      .map(([, action]) => action);

    expect(actions.some((action) => action.startsWith("actions/checkout@"))).toBe(true);
    expect(actions.some((action) => action.startsWith("actions/setup-node@"))).toBe(true);
    expect(actions.every((action) => /@[a-f0-9]{40}$/.test(action))).toBe(true);
  });

  it("does not persist the checkout token and uses the repository CI Node version", () => {
    const checkoutStep = workflow.match(
      /- name: Check out repository\r?\n([\s\S]*?)(?=\r?\n\s+- name:|$)/,
    )?.[0];

    expect(checkoutStep).toContain("persist-credentials: false");
    expect(workflow).toMatch(/node-version:\s*24\b/);
  });
});
