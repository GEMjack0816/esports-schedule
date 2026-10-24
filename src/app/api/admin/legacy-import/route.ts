import { requireAdminApi } from "@/lib/auth/admin-page";
import { trustedMutationOrigin } from "@/lib/auth/vercel";
import { importLegacyRuntimeSubmissions } from "@/lib/review/legacy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    trustedMutationOrigin(request);
  } catch {
    return Response.json({ error: "请求来源无效。" }, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }
  try {
    const counts = await importLegacyRuntimeSubmissions(auth.sub);
    return Response.json({ ok: true, counts }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ ok: false, error: "历史提交迁移失败。" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
