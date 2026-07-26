import { requireAdminApi } from "@/lib/auth/admin-page";
import { importLegacyRuntimeSubmissions } from "@/lib/review/legacy";

export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
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
