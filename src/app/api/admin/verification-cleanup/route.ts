import { requireAdminApi } from "@/lib/auth/admin-page";
import { revalidateTag } from "next/cache";
import { trustedMutationOrigin } from "@/lib/auth/vercel";
import { synchronizePublishedManualMatchesSnapshot } from "@/lib/review/public-matches";
import { getReviewRepository } from "@/lib/review/repository";
import { ReviewConflictError } from "@/lib/review/types";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 2_048;

async function readLimitedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("missing body");

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_REQUEST_BYTES) {
      await reader.cancel().catch(() => {});
      throw new RangeError("request too large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return JSON.parse(text) as unknown;
}

function validRunId(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: Request) {
  if ((process.env.VERCEL_TARGET_ENV ?? process.env.VERCEL_ENV) !== "preview") {
    return Response.json({ error: "Not found" }, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    trustedMutationOrigin(request);
  } catch {
    return Response.json({ error: "请求来源无效。" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
  if (contentLength !== null && (!Number.isSafeInteger(contentLength) || contentLength < 0)) {
    return Response.json({ error: "请求格式无效。" }, { status: 400 });
  }
  if (contentLength !== null && contentLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: "请求过大。" }, { status: 413 });
  }
  try {
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      return Response.json({ error: "请求格式无效。" }, { status: 400 });
    }
    const parsed = await readLimitedJson(request);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return Response.json({ error: "请求格式无效。" }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RangeError) {
      return Response.json({ error: "请求过大。" }, { status: 413 });
    }
    return Response.json({ error: "请求格式无效。" }, { status: 400 });
  }
  const deployedSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  const deployedRef = process.env.VERCEL_GIT_COMMIT_REF?.trim();
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID?.trim();
  if (
    !deployedSha
    || !deployedRef
    || !deploymentId
    || body.gitCommitSha !== deployedSha
    || body.gitCommitRef !== deployedRef
    || body.deploymentId !== deploymentId
    || !validRunId(body.runId)
  ) {
    return Response.json({ error: "验证目标或数据无效。" }, { status: 409 });
  }

  const repository = getReviewRepository();
  try {
    const deleted = await repository.cleanupIsolatedVerificationRun(body.runId);
    await synchronizePublishedManualMatchesSnapshot(repository);
    revalidateTag("published-manual-matches", { expire: 0 });
    return Response.json({ ok: true, deleted }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof ReviewConflictError ? 409 : 503;
    return Response.json({ ok: false, error: "隔离验证数据清理失败。" }, {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
