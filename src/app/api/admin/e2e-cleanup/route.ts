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

class RequestBodyTooLargeError extends Error {}

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

async function readBoundedJson(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("Missing request body");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
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

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const normalizedLength = declaredLength.trim();
    if (!/^\d+$/.test(normalizedLength)) {
      return noStore({ error: "请求无效。" }, 400);
    }
    if (Number(normalizedLength) > MAX_BODY_BYTES) {
      return noStore({ error: "请求无效。" }, 413);
    }
  }

  let payload: unknown;
  try {
    payload = await readBoundedJson(request);
  } catch (error) {
    return noStore({ error: "请求无效。" }, error instanceof RequestBodyTooLargeError ? 413 : 400);
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
