import { NextResponse } from "next/server";
import { beginVercelAuthorization } from "@/lib/auth/vercel";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return NextResponse.redirect(await beginVercelAuthorization(request), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "管理员登录尚未配置或请求来源无效。" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
