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
import { SUBMISSION_REQUEST_POLICY } from "@/lib/submission-request-policy";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Vercel-CDN-Cache-Control": "no-store",
};

class SubmissionBodyTooLargeError extends Error {
  constructor() {
    super("Submission request body exceeds the allowed byte limit.");
    this.name = "SubmissionBodyTooLargeError";
  }
}

class SubmissionOriginError extends Error {}
class SubmissionMediaTypeError extends Error {}
class SubmissionBodyInterruptedError extends Error {}

function cancelRequestBody(body: ReadableStream<Uint8Array> | null): void {
  if (!body) return;
  void body.cancel().catch(() => undefined);
}

function validateSubmissionRequestBoundary(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin) {
    let sourceOrigin: string;
    try {
      sourceOrigin = new URL(origin).origin;
    } catch {
      cancelRequestBody(request.body);
      throw new SubmissionOriginError();
    }
    if (sourceOrigin !== new URL(request.url).origin) {
      cancelRequestBody(request.body);
      throw new SubmissionOriginError();
    }
  }

  const mediaType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    cancelRequestBody(request.body);
    throw new SubmissionMediaTypeError();
  }
}

async function readSubmissionRequestBody(request: Request): Promise<string> {
  const contentLength = request.headers.get("content-length")?.trim();
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > SUBMISSION_REQUEST_POLICY.maxBodyBytes) {
    cancelRequestBody(request.body);
    throw new SubmissionBodyTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let chunkCount = 0;
  let rejectInterrupted: (reason: Error) => void;
  const interrupted = new Promise<never>((_resolve, reject) => { rejectInterrupted = reject; });
  const interrupt = () => {
    // Reject independently of cancel(): a custom/upstream stream may never settle cancellation.
    rejectInterrupted(new SubmissionBodyInterruptedError());
    void reader.cancel().catch(() => undefined);
  };
  const timer = setTimeout(interrupt, SUBMISSION_REQUEST_POLICY.maxBodyReadMs);
  request.signal.addEventListener("abort", interrupt, { once: true });
  try {
    if (request.signal.aborted) interrupt();
    while (true) {
      const { done, value } = await Promise.race([reader.read(), interrupted]);
      if (request.signal.aborted) throw new SubmissionBodyInterruptedError();
      if (done) break;
      chunkCount += 1;
      totalBytes += value.byteLength;
      if (totalBytes > SUBMISSION_REQUEST_POLICY.maxBodyBytes
        || chunkCount > SUBMISSION_REQUEST_POLICY.maxBodyChunks) {
        void reader.cancel().catch(() => undefined);
        throw new SubmissionBodyTooLargeError();
      }
      if (value.byteLength > 0) chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", interrupt);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

type PublicSubmissionOutcome =
  | {
    kind: "created";
    submission: { id: string; status: string; submittedAt: Date };
  }
  | { kind: "duplicate" }
  | { kind: "source-rate-limited"; retryAfterSeconds: number }
  | { kind: "global-rate-limited"; retryAfterSeconds: number }
  | { kind: "new-source-rate-limited"; retryAfterSeconds: number }
  | { kind: "queue-full"; retryAfterSeconds: number }
  | { kind: "service-busy"; retryAfterSeconds: number };

export async function handleSubmissionPost(
  request: Request,
  createSubmission: (
    input: MatchSubmissionInput,
    sourceHash: string,
  ) => Promise<PublicSubmissionOutcome>,
) {
  try {
    validateSubmissionRequestBoundary(request);
    const body = await readSubmissionRequestBody(request);
    const parsed: unknown = JSON.parse(body);
    if (isHoneypotHit(parsed)) {
      return Response.json({
        ok: true,
        status: "pending",
        message: "已保存为待审核，审核通过前不会公开。",
      }, { status: 201, headers: NO_STORE_HEADERS });
    }
    const result = await createSubmission(validateSubmission(parsed), submissionSourceHash(request));
    if (
      result.kind === "source-rate-limited"
      || result.kind === "global-rate-limited"
      || result.kind === "new-source-rate-limited"
      || result.kind === "queue-full"
      || result.kind === "service-busy"
    ) {
      const error = result.kind === "source-rate-limited"
        ? "提交过于频繁，请稍后重试。"
        : result.kind === "queue-full"
          ? "待审核队列暂时已满，请稍后重试。"
          : result.kind === "service-busy"
            ? "提交服务繁忙，请稍后重试。"
            : "公开提交流量较高，请稍后重试。";
      return Response.json({
        ok: false,
        error,
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
    if (error instanceof SubmissionBodyInterruptedError) {
      return Response.json({ ok: false, error: "提交内容接收超时或请求已中断，请重试。" }, {
        status: 408,
        headers: NO_STORE_HEADERS,
      });
    }
    if (error instanceof SubmissionOriginError) {
      return Response.json({ ok: false, error: "跨站提交请求被拒绝。" }, {
        status: 403,
        headers: NO_STORE_HEADERS,
      });
    }
    if (error instanceof SubmissionMediaTypeError) {
      return Response.json({ ok: false, error: "提交内容必须使用 JSON 格式。" }, {
        status: 415,
        headers: NO_STORE_HEADERS,
      });
    }
    if (error instanceof SubmissionBodyTooLargeError) {
      return Response.json({ ok: false, error: "提交内容过大。" }, {
        status: 413,
        headers: NO_STORE_HEADERS,
      });
    }
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
