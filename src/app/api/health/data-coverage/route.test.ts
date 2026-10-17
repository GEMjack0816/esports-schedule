import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSchedule } from "@/lib/schedule";
import { getPublicVersionSummary } from "@/lib/version";
import { getDatabaseHealth } from "@/lib/review/public-matches";
import { getPreviewDatabaseTargetFingerprint } from "@/db/identity";
import { GET } from "./route";

vi.mock("@/lib/schedule", () => ({ getSchedule: vi.fn() }));
vi.mock("@/lib/version", () => ({ getPublicVersionSummary: vi.fn() }));
vi.mock("@/lib/review/public-matches", () => ({ getDatabaseHealth: vi.fn() }));
vi.mock("@/db/identity", () => ({ getPreviewDatabaseTargetFingerprint: vi.fn() }));

const database = {
  configured: true,
  status: "connected",
  lastSuccessfulReadAt: "2026-10-15T00:00:00.000Z",
  cachedManualMatches: 0,
  submissionCounts: { pending: 0, approved: 0, rejected: 0, publishedManualMatches: 0 },
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSchedule).mockResolvedValue({ demoMode: false, providers: {}, deployment: {}, coverage: {} } as Awaited<ReturnType<typeof getSchedule>>);
  vi.mocked(getPublicVersionSummary).mockReturnValue({
    gitCommitSha: "preview-sha",
    deploymentId: "dpl_preview",
    buildTimestamp: "2026-10-15T00:00:00.000Z",
  });
  vi.mocked(getDatabaseHealth).mockResolvedValue(database);
  vi.mocked(getPreviewDatabaseTargetFingerprint).mockReturnValue("a".repeat(64));
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/health/data-coverage database identity", () => {
  it("returns an uncached target fingerprint only in Preview", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const preview = await GET();
    const previewBody = await preview.json();
    expect(preview.status).toBe(200);
    expect(previewBody.database).toMatchObject({ status: "connected", targetFingerprint: "a".repeat(64) });
    expect(preview.headers.get("cache-control")).toContain("no-store");

    vi.stubEnv("VERCEL_ENV", "production");
    const production = await GET();
    const productionBody = await production.json();
    expect(productionBody.database).toEqual(database);
    expect(productionBody.database).not.toHaveProperty("targetFingerprint");
  });
});
