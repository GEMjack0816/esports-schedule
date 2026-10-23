import { revalidateTag } from "next/cache";
import { requireAdminApi } from "@/lib/auth/admin-page";
import { trustedMutationOrigin } from "@/lib/auth/vercel";
import { getReviewRepository } from "@/lib/review/repository";
import { isAdminE2ECleanupEnabled } from "@/lib/review/e2e-cleanup-guard";
import { synchronizePublishedManualMatchesSnapshot } from "@/lib/review/public-matches";
import { PUBLISHED_MANUAL_MATCHES_TAG } from "@/lib/review/service";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 4_096;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CleanupRequest = { runId: string };

function parseCleanupRequest(value: unknown): CleanupRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.runId !== "string" || !UUID_PATTERN.test(input.runId)) {
    return null;
  }
  return { runId: input.runId };
}

function noStore(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  if (!isAdminE2ECleanupEnabled()) return noStore({ error: "Not found" }, 404);

  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    trustedMutationOrigin(request);
  } catch {
    return noStore({ error: "请求来源无效。" }, 403);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return noStore({ error: "请求无效。" }, 413);
  let text: string;
  try {
    text = await request.text();
  } catch {
    return noStore({ error: "请求无效。" }, 400);
  }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return noStore({ error: "请求无效。" }, 413);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return noStore({ error: "请求无效。" }, 400);
  }
  const input = parseCleanupRequest(payload);
  if (!input) return noStore({ error: "请求无效。" }, 400);

  const repository = getReviewRepository();
  let result: Awaited<ReturnType<typeof repository.cleanupE2eVerificationRun>>;
  try {
    result = await repository.cleanupE2eVerificationRun(input.runId);
  } catch {
    return noStore({ error: "验证数据清理失败。" }, 503);
  }
  if (!result.cleaned) return noStore({ error: "验证记录范围不匹配。" }, 409);

  let cacheError = false;
  try {
    await synchronizePublishedManualMatchesSnapshot(repository);
  } catch {
    cacheError = true;
  }
  try {
    revalidateTag(PUBLISHED_MANUAL_MATCHES_TAG, { expire: 0 });
  } catch {
    cacheError = true;
  }
  if (cacheError) {
    return noStore({ ok: false, cleaned: true, cacheRefreshed: false }, 503);
  }
  return noStore({ ok: true, cacheRefreshed: true, ...result }, 200);
}
