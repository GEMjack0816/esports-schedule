import { requireAdminApi } from "@/lib/auth/admin-page";
import { trustedMutationOrigin } from "@/lib/auth/vercel";
import { cleanupVerificationRun } from "@/lib/review/service";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" };
const MAX_BODY_LENGTH = 1_024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") {
    return Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  try {
    trustedMutationOrigin(request);
  } catch {
    return Response.json({ error: "请求来源无效。" }, { status: 403, headers: NO_STORE });
  }

  try {
    const bodyText = await request.text();
    if (bodyText.length > MAX_BODY_LENGTH) {
      return Response.json({ error: "请求内容过大。" }, { status: 413, headers: NO_STORE });
    }
    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return Response.json({ error: "请求格式无效。" }, { status: 400, headers: NO_STORE });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "请求格式无效。" }, { status: 400, headers: NO_STORE });
    }
    const runId = (body as Record<string, unknown>).runId;
    if (typeof runId !== "string" || !UUID_PATTERN.test(runId)) {
      return Response.json({ error: "验证运行标识无效。" }, { status: 400, headers: NO_STORE });
    }

    let counts;
    try {
      counts = await cleanupVerificationRun(runId.toLowerCase());
    } catch {
      return Response.json({ ok: false, error: "Preview 验证数据清理失败。" }, {
        status: 503,
        headers: NO_STORE,
      });
    }
    return Response.json({ ok: true, runId: runId.toLowerCase(), counts }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "请求格式无效。" }, { status: 400, headers: NO_STORE });
  }
}
