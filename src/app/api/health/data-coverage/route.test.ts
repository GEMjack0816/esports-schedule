import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSchedule } from "@/lib/schedule";
import { getPublicVersionSummary } from "@/lib/version";
import { getDatabaseHealth } from "@/lib/review/public-matches";
import { getPreviewDatabaseTargetFingerprint } from "@/db/identity";
import { requireAdminApi } from "@/lib/auth/admin-page";
import { GET } from "./route";

vi.mock("@/lib/schedule", () => ({ getSchedule: vi.fn() }));
vi.mock("@/lib/version", () => ({ getPublicVersionSummary: vi.fn() }));
vi.mock("@/lib/review/public-matches", () => ({ getDatabaseHealth: vi.fn() }));
vi.mock("@/db/identity", () => ({ getPreviewDatabaseTargetFingerprint: vi.fn() }));
vi.mock("@/lib/auth/admin-page", () => ({ requireAdminApi: vi.fn() }));

const database = {
  configured: true,
  status: "connected",
  lastSuccessfulReadAt: "2026-10-15T00:00:00.000Z",
  cachedManualMatches: 0,
  cacheRevision: 0,
  pendingCacheRevisions: 0,
  submissionCounts: { pending: 0, approved: 0, rejected: 0, publishedManualMatches: 0 },
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSchedule).mockResolvedValue({
    demoMode: false,
    providers: {},
    deployment: {},
    coverage: {},
  } as Awaited<ReturnType<typeof getSchedule>>);
  vi.mocked(getPublicVersionSummary).mockReturnValue({
    gitCommitSha: "preview-sha",
    deploymentId: "preview-deployment",
    buildTimestamp: "2026-10-15T00:00:00.000Z",
  });
  vi.mocked(getDatabaseHealth).mockResolvedValue(database);
  vi.mocked(getPreviewDatabaseTargetFingerprint).mockReturnValue("a".repeat(64));
  vi.mocked(requireAdminApi).mockResolvedValue({
    ok: false,
    response: Response.json({ error: "Unauthorized" }, { status: 401 }),
  });
});

describe("data coverage health route database identity", () => {
  it("includes the non-secret target fingerprint for an authenticated Preview admin", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.mocked(requireAdminApi).mockResolvedValue({ ok: true, sub: "preview-admin-test" });
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.database.targetFingerprint).toBe("a".repeat(64));
    expect(body.database.status).toBe("connected");
    expect(body).not.toHaveProperty("sub");
    expect(JSON.stringify(body)).not.toContain("preview-admin-test");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(requireAdminApi).toHaveBeenCalledOnce();
  });

  it("does not expose the target fingerprint to anonymous Preview health requests", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.database).toEqual(database);
    expect(body.database).not.toHaveProperty("targetFingerprint");
    expect(getPreviewDatabaseTargetFingerprint).not.toHaveBeenCalled();
  });

  it("fails closed and keeps health available when Preview auth throws", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.mocked(requireAdminApi).mockRejectedValue(new Error("auth failure"));
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.database).toEqual(database);
    expect(getPreviewDatabaseTargetFingerprint).not.toHaveBeenCalled();
  });

  it("does not expose database target fingerprints in Production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.database).toEqual(database);
    expect(body.database).not.toHaveProperty("targetFingerprint");
    expect(getPreviewDatabaseTargetFingerprint).not.toHaveBeenCalled();
    expect(requireAdminApi).not.toHaveBeenCalled();
  });
});
