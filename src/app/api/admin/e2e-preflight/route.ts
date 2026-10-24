import { requireAdminApi } from "@/lib/auth/admin-page";
import { trustedMutationOrigin } from "@/lib/auth/vercel";
import { isAdminE2ECleanupEnabled } from "@/lib/review/e2e-cleanup-guard";

export const dynamic = "force-dynamic";

function noStore(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  // This guard includes the exact server-side DATABASE_URL hostname allowlist.
  // Fail closed before exposing whether the preflight route is enabled.
  if (!isAdminE2ECleanupEnabled()) return noStore({ error: "Not found" }, 404);

  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    trustedMutationOrigin(request);
  } catch {
    return noStore({ error: "请求来源无效。" }, 403);
  }

  // The database hostname and URL are intentionally never returned to callers.
  return noStore({ ok: true }, 200);
}
