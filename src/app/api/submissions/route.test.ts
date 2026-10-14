import { describe, expect, it, vi } from "vitest";
import { handleSubmissionPost } from "./route";

const valid = {
  game: "lol",
  league: "LPL",
  teamA: "Alpha",
  teamB: "Beta",
  scheduledAt: "2026-08-01T00:00:00.000Z",
  bestOf: 3,
  sourceUrl: "https://example.com/source",
  notes: null,
  website: "",
};

function request(body: unknown) {
  return new Request("https://example.com/api/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-real-ip": "203.0.113.10" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/submissions", () => {
  it("returns only the public receipt fields and no-store headers", async () => {
    const createSubmission = vi.fn(async (...args: unknown[]) => {
      expect(args).toHaveLength(2);
      return {
        kind: "created" as const,
        submission: {
          id: "11111111-1111-4111-8111-111111111111",
          status: "pending",
          submittedAt: new Date("2026-07-26T00:00:00.000Z"),
          sourceUrl: "https://secret-ish.example/source",
          notes: "not returned",
        },
      };
    });
    const response = await handleSubmissionPost(request(valid), createSubmission);
    const payload = await response.json();
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(payload).toEqual({
      ok: true,
      id: "11111111-1111-4111-8111-111111111111",
      status: "pending",
      submittedAt: "2026-07-26T00:00:00.000Z",
      message: "已保存为待审核，审核通过前不会公开。",
    });
    expect(createSubmission.mock.calls[0]?.[1]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns 409 for an active duplicate fingerprint", async () => {
    const createSubmission = async () => ({ kind: "duplicate" as const });
    const response = await handleSubmissionPost(request(valid), createSubmission);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      code: "DUPLICATE_SUBMISSION",
      error: "相同比赛已在待审核或已发布列表中。",
    });
  });

  it("uses the same stable duplicate code for a database uniqueness conflict", async () => {
    const createSubmission = async () => {
      throw Object.assign(new Error("conflict"), { code: "DUPLICATE_SUBMISSION" });
    };
    const response = await handleSubmissionPost(request(valid), createSubmission);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, code: "DUPLICATE_SUBMISSION" });
  });

  it("returns 429 with Retry-After when the source window is exhausted", async () => {
    const response = await handleSubmissionPost(
      request(valid),
      async () => ({ kind: "source-rate-limited", retryAfterSeconds: 321 }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("321");
    expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining("频繁") });
  });

  it.each([
    ["global-rate-limited" as const, "流量"],
    ["new-source-rate-limited" as const, "流量"],
    ["service-busy" as const, "繁忙"],
  ])("returns a bounded 429 response for %s", async (kind, message) => {
    const response = await handleSubmissionPost(
      request(valid),
      async () => ({ kind, retryAfterSeconds: 5 }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining(message) });
  });

  it("returns 429 with Retry-After when the global pending queue is full", async () => {
    const response = await handleSubmissionPost(
      request(valid),
      async () => ({ kind: "queue-full", retryAfterSeconds: 900 }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("900");
    expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining("队列") });
  });

  it("returns 503 without pretending success when PostgreSQL is unavailable", async () => {
    const createSubmission = async () => {
      throw Object.assign(new Error("unavailable"), { code: "DATABASE_UNAVAILABLE" });
    };
    const response = await handleSubmissionPost(request(valid), createSubmission);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false });
  });

  it("accepts a honeypot hit without writing or exposing a record id", async () => {
    const createSubmission = vi.fn();
    const response = await handleSubmissionPost(
      request({ ...valid, website: "spam.example" }),
      createSubmission,
    );
    expect(response.status).toBe(201);
    expect(createSubmission).not.toHaveBeenCalled();
    expect(await response.json()).not.toHaveProperty("id");
  });

  it("rejects payloads above 10 KB", async () => {
    const createSubmission = vi.fn();
    const response = await handleSubmissionPost(
      request({ ...valid, notes: "x".repeat(10_001) }),
      createSubmission,
    );
    expect(response.status).toBe(413);
    expect(createSubmission).not.toHaveBeenCalled();
  });
});
