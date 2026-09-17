import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  createPublicSubmission: vi.fn(),
  consumePublicSubmissionHoneypot: vi.fn(),
}));

vi.mock("@/lib/review/repository", () => ({ getReviewRepository: () => repository }));

import { POST } from "./route";

const valid = {
  game: "lol",
  league: "Combined verification league",
  teamA: "Alpha",
  teamB: "Beta",
  scheduledAt: "2026-08-01T00:00:00.000Z",
  bestOf: 3,
  sourceUrl: "https://example.com/source",
  website: "",
};

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://preview.example/api/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://preview.example", ...headers },
    body: JSON.stringify(body),
  });
}

describe("public submission route wiring", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    repository.createPublicSubmission.mockResolvedValue({
      kind: "created",
      submission: {
        id: "11111111-1111-4111-8111-111111111111",
        status: "pending",
        submittedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
    });
    repository.consumePublicSubmissionHoneypot.mockResolvedValue({ kind: "honeypot" });
  });

  it("dispatches a validated normal request to the persisted submission gate", async () => {
    const response = await POST(request(valid));
    expect(response.status).toBe(201);
    expect(repository.createPublicSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ league: valid.league, scheduledAt: valid.scheduledAt }),
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(repository.consumePublicSubmissionHoneypot).not.toHaveBeenCalled();
  });

  it("dispatches a honeypot to the shared limiter without creating a submission", async () => {
    const response = await POST(request({ website: "bot.example" }));
    expect(response.status).toBe(201);
    expect(repository.consumePublicSubmissionHoneypot).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(repository.createPublicSubmission).not.toHaveBeenCalled();
    expect(await response.json()).not.toHaveProperty("id");
  });

  it("propagates the honeypot limiter's bounded 429 rather than bypassing it", async () => {
    repository.consumePublicSubmissionHoneypot.mockResolvedValue({
      kind: "global-rate-limited", retryAfterSeconds: 19,
    });
    const response = await POST(request({ website: "bot.example" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("19");
    expect(repository.createPublicSubmission).not.toHaveBeenCalled();
  });

  it.each([
    ["cross-origin honeypot", { website: "bot.example" }, { Origin: "https://attacker.example" }, 403],
    ["oversized honeypot", { website: "bot.example", padding: "x".repeat(10_001) }, {}, 413],
    ["unsafe normal text", { ...valid, teamA: "Alpha\u202Espoof" }, {}, 400],
  ])("rejects %s before either database gate", async (_name, body, headers, status) => {
    const response = await POST(request(body, headers));
    expect(response.status).toBe(status);
    expect(repository.createPublicSubmission).not.toHaveBeenCalled();
    expect(repository.consumePublicSubmissionHoneypot).not.toHaveBeenCalled();
  });
});
