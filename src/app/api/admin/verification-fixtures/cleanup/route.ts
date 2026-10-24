import { revalidateTag } from "next/cache";
import { requireAdminApi } from "@/lib/auth/admin-page";
import { trustedMutationOrigin } from "@/lib/auth/vercel";
import { synchronizePublishedManualMatchesSnapshot } from "@/lib/review/public-matches";
import { getReviewRepository } from "@/lib/review/repository";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Vercel-CDN-Cache-Control": "no-store",
};

function previewTargetMatches(body: unknown): body is {
  runId: string;
  expectedRef: string;
  expectedSha: string;
} {
  if (!body || typeof body !== "object") return false;
  const candidate = body as Record<string, unknown>;
  return typeof candidate.runId === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate.runId)
    && typeof candidate.expectedRef === "string"
    && candidate.expectedRef !== "main"
    && candidate.expectedRef.length > 0
    && candidate.expectedRef.length <= 255
    && candidate.expectedRef === process.env.VERCEL_GIT_COMMIT_REF
    && typeof candidate.expectedSha === "string"
    && /^[0-9a-f]{40}$/i.test(candidate.expectedSha)
    && candidate.expectedSha.toLowerCase() === process.env.VERCEL_GIT_COMMIT_SHA?.toLowerCase();
}

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") {
    return Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE_HEADERS });
  }

  let body: unknown;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 2_048) {
    return Response.json({ error: "Request too large" }, { status: 413, headers: NO_STORE_HEADERS });
  }
  try {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return Response.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 2_048) {
      return Response.json({ error: "Request too large" }, { status: 413, headers: NO_STORE_HEADERS });
    }
    body = JSON.parse(text) as unknown;
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (!previewTargetMatches(body)) {
    return Response.json({ error: "Preview deployment identity mismatch" }, {
      status: 409,
      headers: NO_STORE_HEADERS,
    });
  }

  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    trustedMutationOrigin(request);
  } catch {
    return Response.json({ error: "Invalid request origin" }, { status: 403, headers: NO_STORE_HEADERS });
  }

  try {
    const repository = getReviewRepository();
    const result = await repository.cleanupAdminVerificationRun(body.runId);
    if (result.deletedPublishedMatches > 0) {
      await synchronizePublishedManualMatchesSnapshot(repository);
      revalidateTag("published-manual-matches", { expire: 0 });
    }
    return Response.json({ ok: true, ...result }, { headers: NO_STORE_HEADERS });
  } catch {
    return Response.json({ error: "Preview verification cleanup failed" }, {
      status: 503,
      headers: NO_STORE_HEADERS,
    });
  }
}
