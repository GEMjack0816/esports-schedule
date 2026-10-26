export const SUBMISSION_UNAVAILABLE_MESSAGE = "提交服务暂时不可用，请稍后重试。";
export const SUBMISSION_TIMEOUT_MS = 15_000;
export const SUBMISSION_TIMEOUT_MESSAGE = "等待提交响应超时，服务器可能已经收到请求。请稍后用相同信息重试；重复比赛会被系统拦截。";

export class SubmissionResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubmissionResponseError";
  }
}

type SubmissionResult = {
  message?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readSubmissionResult(response: Response): Promise<SubmissionResult> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new SubmissionResponseError(SUBMISSION_UNAVAILABLE_MESSAGE);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new SubmissionResponseError(SUBMISSION_UNAVAILABLE_MESSAGE);
  }

  if (!isRecord(payload) || typeof payload.ok !== "boolean") {
    throw new SubmissionResponseError(SUBMISSION_UNAVAILABLE_MESSAGE);
  }

  if (!response.ok || payload.ok !== true) {
    const error = typeof payload.error === "string" && payload.error.trim()
      ? payload.error.trim()
      : SUBMISSION_UNAVAILABLE_MESSAGE;
    throw new SubmissionResponseError(error);
  }

  return {
    message: typeof payload.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : undefined,
  };
}

export async function postPublicSubmission(
  payload: unknown,
  fetcher: typeof fetch = fetch,
  timeoutMs = SUBMISSION_TIMEOUT_MS,
): Promise<SubmissionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher("/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return await readSubmissionResult(response);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new SubmissionResponseError(SUBMISSION_TIMEOUT_MESSAGE);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function submissionErrorMessage(error: unknown): string {
  return error instanceof SubmissionResponseError
    ? error.message
    : SUBMISSION_UNAVAILABLE_MESSAGE;
}
