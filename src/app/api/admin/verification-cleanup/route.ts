import { requireAdminApi } from "@/lib/auth/admin-page";
import { revalidateTag } from "next/cache";
import { trustedMutationOrigin } from "@/lib/auth/vercel";
import { synchronizePublishedManualMatchesSnapshot } from "@/lib/review/public-matches";
import { getReviewRepository } from "@/lib/review/repository";
import { ReviewConflictError } from "@/lib/review/types";

export const dynamic = "force-dynamic";

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
  try {
    body = await request.json();
  } catch {
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
