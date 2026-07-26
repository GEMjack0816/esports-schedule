import { NextResponse } from "next/server";
import { revokeAndClearSession, trustedRequestOrigin } from "@/lib/auth/vercel";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let origin: string;
  try {
    origin = trustedRequestOrigin(request);
  } catch {
    return Response.json({ error: "请求来源无效。" }, { status: 403 });
  }
  await revokeAndClearSession();
  return NextResponse.redirect(new URL("/admin/login", origin), {
    status: 303,
    headers: { "Cache-Control": "no-store" },
  });
}
