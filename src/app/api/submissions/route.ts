import { getReviewRepository } from "@/lib/review/repository";
import {
  DatabaseUnavailableError,
  DuplicateSubmissionError,
} from "@/lib/review/types";
import {
  isHoneypotHit,
  SubmissionValidationError,
  validateSubmission,
} from "@/lib/submissions";
import type { MatchSubmissionInput } from "@/lib/submissions";
import { submissionSourceHash } from "@/lib/review/submission-protection";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Vercel-CDN-Cache-Control": "no-store",
};

type PublicSubmissionOutcome =
  | {
    kind: "created";
    submission: { id: string; status: string; submittedAt: Date };
  }
  | { kind: "duplicate" }
  | { kind: "rate-limited"; retryAfterSeconds: number }
  | { kind: "queue-full"; retryAfterSeconds: number };

export async function handleSubmissionPost(
  request: Request,
  createSubmission: (
    input: MatchSubmissionInput,
    sourceHash: string,
  ) => Promise<PublicSubmissionOutcome>,
) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 10_000) {
    return Response.json({ ok: false, error: "提交内容过大。" }, {
      status: 413,
      headers: NO_STORE_HEADERS,
    });
  }

  try {
    const body = await request.text();
    if (body.length > 10_000) {
      return Response.json({ ok: false, error: "提交内容过大。" }, {
        status: 413,
        headers: NO_STORE_HEADERS,
      });
    }
    const parsed: unknown = JSON.parse(body);
    if (isHoneypotHit(parsed)) {
      return Response.json({
        ok: true,
        status: "pending",
        message: "已保存为待审核，审核通过前不会公开。",
      }, { status: 201, headers: NO_STORE_HEADERS });
    }
    const result = await createSubmission(validateSubmission(parsed), submissionSourceHash(request));
    if (result.kind === "rate-limited" || result.kind === "queue-full") {
      return Response.json({
        ok: false,
        error: result.kind === "rate-limited"
          ? "提交过于频繁，请稍后重试。"
          : "待审核队列暂时已满，请稍后重试。",
      }, {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "Retry-After": String(result.retryAfterSeconds),
        },
      });
    }
    if (result.kind === "duplicate") {
      return Response.json({ ok: false, error: "相同比赛已在待审核或已发布列表中。" }, {
        status: 409,
        headers: NO_STORE_HEADERS,
      });
    }
    const submission = result.submission;
    return Response.json({
      ok: true,
      id: submission.id,
      status: submission.status,
      submittedAt: submission.submittedAt.toISOString(),
      message: "已保存为待审核，审核通过前不会公开。",
    }, { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    const errorCode = error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : null;
    if (errorCode === "DUPLICATE_SUBMISSION" || error instanceof DuplicateSubmissionError) {
      return Response.json({ ok: false, error: "相同比赛已在待审核或已发布列表中。" }, {
        status: 409,
        headers: NO_STORE_HEADERS,
      });
    }
    if (errorCode === "DATABASE_UNAVAILABLE" || error instanceof DatabaseUnavailableError) {
      return Response.json({ ok: false, error: "提交服务暂时不可用，请稍后重试。" }, {
        status: 503,
        headers: NO_STORE_HEADERS,
      });
    }
    if (error instanceof SyntaxError || error instanceof SubmissionValidationError) {
      const message = error instanceof SubmissionValidationError ? error.message : "提交内容格式无效。";
      return Response.json({ ok: false, error: message }, {
        status: 400,
        headers: NO_STORE_HEADERS,
      });
    }
    return Response.json({ ok: false, error: "提交失败，请稍后重试。" }, {
      status: 500,
      headers: NO_STORE_HEADERS,
    });
  }
}

export async function POST(request: Request) {
  return handleSubmissionPost(
    request,
    (input, sourceHash) => getReviewRepository().createPublicSubmission(input, sourceHash),
  );
}
