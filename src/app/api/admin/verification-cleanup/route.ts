import { revalidateTag } from "next/cache";
import { requireAdminApi } from "@/lib/auth/admin-page";
import { trustedMutationOrigin } from "@/lib/auth/vercel";
import { getReviewRepository } from "@/lib/review/repository";
import {
  PUBLISHED_MANUAL_MATCHES_TAG,
} from "@/lib/review/service";
import { synchronizePublishedManualMatchesSnapshot } from "@/lib/review/public-matches";
import type { VerificationCleanupResult } from "@/lib/review/types";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 1_024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AuthorizationResult =
  | { ok: true; sub: string }
  | { ok: false; response: Response };

type VerificationCleanupDependencies = {
  environment: string | undefined;
  authorize: () => Promise<AuthorizationResult>;
  verifyOrigin: (request: Request) => unknown;
  cleanup: (runMarker: string) => Promise<VerificationCleanupResult>;
  synchronize: () => Promise<unknown>;
  invalidate: () => void;
};

function parseRunMarker(body: string): string {
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
    throw new Error("INVALID_BODY");
  }
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== "object") throw new Error("INVALID_BODY");
  const runMarker = (parsed as Record<string, unknown>).runMarker;
  if (typeof runMarker !== "string" || !UUID_PATTERN.test(runMarker)) {
    throw new Error("INVALID_MARKER");
  }
  return runMarker;
}

export async function handleVerificationCleanup(
  request: Request,
  dependencies: VerificationCleanupDependencies,
): Promise<Response> {
  if (dependencies.environment !== "preview") {
    return Response.json({ error: "Not found" }, {
      status: 404,
      headers: NO_STORE_HEADERS,
    });
  }

  const auth = await dependencies.authorize();
  if (!auth.ok) return auth.response;
  try {
    dependencies.verifyOrigin(request);
  } catch {
    return Response.json({ error: "请求来源无效。" }, {
      status: 403,
      headers: NO_STORE_HEADERS,
    });
  }

  let runMarker: string;
  try {
    runMarker = parseRunMarker(await request.text());
  } catch {
    return Response.json({ error: "验证清理请求无效。" }, {
      status: 400,
      headers: NO_STORE_HEADERS,
    });
  }

  try {
    const result = await dependencies.cleanup(runMarker);
    let synchronizationError: unknown;
    try {
      await dependencies.synchronize();
    } catch (error) {
      synchronizationError = error;
    } finally {
      dependencies.invalidate();
    }
    if (synchronizationError) throw synchronizationError;
    return Response.json({ ok: true, result }, { headers: NO_STORE_HEADERS });
  } catch {
    return Response.json({ ok: false, error: "验证数据清理失败。" }, {
      status: 503,
      headers: NO_STORE_HEADERS,
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  const repository = getReviewRepository();
  return handleVerificationCleanup(request, {
    environment: process.env.VERCEL_TARGET_ENV ?? process.env.VERCEL_ENV,
    authorize: requireAdminApi,
    verifyOrigin: trustedMutationOrigin,
    cleanup: (runMarker) => repository.cleanupVerificationRun(runMarker),
    synchronize: () => synchronizePublishedManualMatchesSnapshot(repository),
    invalidate: () => revalidateTag(PUBLISHED_MANUAL_MATCHES_TAG, { expire: 0 }),
  });
}
