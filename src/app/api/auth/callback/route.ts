import { NextResponse } from "next/server";
import {
  AuthForbiddenError,
  completeVercelAuthorization,
  trustedRequestOrigin,
} from "@/lib/auth/vercel";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const result = await completeVercelAuthorization(request);
    // TODO(PR6-PREVIEW-OAUTH-SUB-DIAGNOSTIC): Remove this response together with the
    // Preview-only diagnostic branch after ADMIN_VERCEL_USER_IDS is confirmed.
    if (result.kind === "preview-sub-diagnostic") {
      return Response.json({ sub: result.sub }, {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "X-Robots-Tag": "noindex, nofollow",
        },
      });
    }
    return NextResponse.redirect(new URL(result.returnTo, trustedRequestOrigin(request)), {
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
