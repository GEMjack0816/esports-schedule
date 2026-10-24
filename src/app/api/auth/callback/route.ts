import { NextResponse } from "next/server";
import {
  AuthForbiddenError,
  completeVercelAuthorization,
  trustedRequestOrigin,
} from "@/lib/auth/vercel";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const returnTo = await completeVercelAuthorization(request);
    return NextResponse.redirect(new URL(returnTo, trustedRequestOrigin(request)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status = error instanceof AuthForbiddenError ? 403 : 503;
    return Response.json({ error: status === 403 ? "管理员授权失败。" : "管理员登录暂时不可用。" }, {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
