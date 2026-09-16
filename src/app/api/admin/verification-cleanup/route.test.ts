import { describe, expect, it, vi } from "vitest";
import { handleVerificationCleanup } from "./route";

const runMarker = "b145d4d6-f62f-4b49-9e15-0946fd7aa747";

function request(body: unknown = { runMarker }, origin = "https://preview.example") {
  return new Request(`${origin}/api/admin/verification-cleanup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify(body),
  });
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    environment: "preview",
    authorize: vi.fn(async () => ({ ok: true as const, sub: "admin" })),
    verifyOrigin: vi.fn(),
    cleanup: vi.fn(async () => ({
      submissionsDeleted: 2,
      manualMatchesDeleted: 1,
      auditEventsDeleted: 5,
    })),
    synchronize: vi.fn(async () => undefined),
    invalidate: vi.fn(),
    ...overrides,
  };
}

describe("POST /api/admin/verification-cleanup", () => {
  it("is unavailable outside Preview before authentication or database access", async () => {
    const deps = dependencies({ environment: "production" });
    const response = await handleVerificationCleanup(request(), deps);
    expect(response.status).toBe(404);
    expect(deps.authorize).not.toHaveBeenCalled();
    expect(deps.cleanup).not.toHaveBeenCalled();
  });

  it("requires a current administrator session", async () => {
    const deps = dependencies({
      authorize: vi.fn(async () => ({
        ok: false as const,
        response: Response.json({ error: "Unauthorized" }, { status: 401 }),
      })),
    });
    const response = await handleVerificationCleanup(request(), deps);
    expect(response.status).toBe(401);
    expect(deps.cleanup).not.toHaveBeenCalled();
  });

  it("rejects cross-origin and malformed cleanup requests", async () => {
    const crossOrigin = dependencies({
      verifyOrigin: vi.fn(() => { throw new Error("invalid origin"); }),
    });
    expect((await handleVerificationCleanup(request(), crossOrigin)).status).toBe(403);
    expect(crossOrigin.cleanup).not.toHaveBeenCalled();

    const malformed = dependencies();
    expect((await handleVerificationCleanup(request({ runMarker: "not-a-uuid" }), malformed)).status)
      .toBe(400);
    expect(malformed.cleanup).not.toHaveBeenCalled();
  });

  it("cleans only the marked run and refreshes both cache layers", async () => {
    const deps = dependencies();
    const response = await handleVerificationCleanup(request(), deps);
    expect(response.status).toBe(200);
    expect(deps.cleanup).toHaveBeenCalledWith(runMarker);
    expect(deps.synchronize).toHaveBeenCalledOnce();
    expect(deps.invalidate).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({
      ok: true,
      result: {
        submissionsDeleted: 2,
        manualMatchesDeleted: 1,
        auditEventsDeleted: 5,
      },
    });
  });

  it("invalidates the Next cache even if Runtime Cache synchronization fails", async () => {
    const deps = dependencies({
      synchronize: vi.fn(async () => { throw new Error("cache unavailable"); }),
    });
    const response = await handleVerificationCleanup(request(), deps);
    expect(response.status).toBe(503);
    expect(deps.invalidate).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({
      ok: false,
      error: "验证数据清理失败。",
    });
  });
});
