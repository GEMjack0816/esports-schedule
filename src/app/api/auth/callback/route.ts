import { NextResponse } from "next/server";
import {
  AuthConfigurationError,
  AuthForbiddenError,
  completeVercelAuthorization,
  trustedRequestOrigin,
} from "@/lib/auth/vercel";

export const dynamic = "force-dynamic";

function previewDiagnosticFailureKey(error: unknown): string | null {
  const isTargetPreview = process.env.VERCEL_ENV === "preview"
    || process.env.VERCEL_GIT_COMMIT_REF === "agent/add-submission-review-workflow";
  if (!isTargetPreview) {
    return null;
  }
  if (error instanceof AuthConfigurationError) return "authConfigurationFailed";
  if (!(error instanceof AuthForbiddenError)) return "authorizationUnavailable";
  if (error.diagnosticStage) return error.diagnosticStage;
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
    const failureKey = previewDiagnosticFailureKey(error);
    return Response.json({
      error: status === 403 ? "管理员授权失败。" : "管理员登录暂时不可用。",
      ...(failureKey ? { [failureKey]: true } : {}),
    }, {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
