import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { publishedFromForm, submissionFromForm } from "./form-data";

describe("admin form datetime boundary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes submission edit time to UTC before validation", () => {
    const form = new FormData();
    form.set("submission.scheduledAt", "2026-08-20T03:45");

    expect(submissionFromForm(form).scheduledAt).toBe("2026-08-20T03:45:00.000Z");
  });

  it("normalizes published match time to UTC before validation", () => {
    const form = new FormData();
    form.set("published.startTimeUtc", "2026-08-20T03:45");

    expect(publishedFromForm(form).startTimeUtc).toBe("2026-08-20T03:45:00.000Z");
  });

  it("preserves empty optional published time", () => {
    const form = new FormData();

    expect(publishedFromForm(form).startTimeUtc).toBeNull();
  });
});
