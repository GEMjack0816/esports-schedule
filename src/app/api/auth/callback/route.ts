import { NextResponse } from "next/server";
import {
  AuthForbiddenError,
  completeVercelAuthorization,
  trustedRequestOrigin,
} from "@/lib/auth/vercel";

export const dynamic = "force-dynamic";

function previewDiagnosticFailureKey(request: Request, error: AuthForbiddenError): string | null {
  if (new URL(request.url).hostname !== "esports-schedule-git-agent-add-submi-938f1d-jack-zhu-s-projects.vercel.app") {
    return null;
  }
  if (error.message.includes("状态校验")) return "oauthStateFailed";
  if (error.message.includes("令牌交换")) return "tokenExchangeFailed";
  if (error.message.includes("响应不完整")) return "tokenResponseIncomplete";
  if (error.message.includes("ID Token")) return "idTokenVerificationFailed";
  if (error.message.includes("白名单")) return "adminWhitelistMismatch";
  return "authorizationFailed";
}

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
    const failureKey = error instanceof AuthForbiddenError
      ? previewDiagnosticFailureKey(request, error)
      : null;
    return Response.json({
      error: status === 403 ? "管理员授权失败。" : "管理员登录暂时不可用。",
      ...(failureKey ? { [failureKey]: true } : {}),
    }, {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
