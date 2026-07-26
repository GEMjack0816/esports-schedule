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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/submissions", () => {
  it("returns only the public receipt fields and no-store headers", async () => {
    const createSubmission = vi.fn(async () => ({
      id: "11111111-1111-4111-8111-111111111111",
      status: "pending",
      submittedAt: new Date("2026-07-26T00:00:00.000Z"),
      sourceUrl: "https://secret-ish.example/source",
      notes: "not returned",
    }));
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
  });

  it("returns 409 for an active duplicate fingerprint", async () => {
    const createSubmission = async () => {
      throw Object.assign(new Error("duplicate"), { code: "DUPLICATE_SUBMISSION" });
    };
    const response = await handleSubmissionPost(request(valid), createSubmission);
    expect(response.status).toBe(409);
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
