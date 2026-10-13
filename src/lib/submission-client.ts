export const SUBMISSION_REQUEST_TIMEOUT_MS = 15_000;
export const SUBMISSION_REQUEST_ERROR = "提交失败，请稍后重试。";
export const SUBMISSION_REQUEST_TIMEOUT_ERROR = "提交超时，请检查网络后重试。";

type SubmissionRequestResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedMessage(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}

function isJsonContentType(response: Response): boolean {
  const mediaType = response.headers.get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  return mediaType === "application/json";
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSubmissionReceipt(value: unknown): value is { ok: true; status: "pending"; message: string } {
  if (!isRecord(value)
    || value.ok !== true
    || value.status !== "pending"
    || !isBoundedMessage(value.message)) return false;

  if (value.id !== undefined && !isUuid(value.id)) return false;
  if (value.submittedAt !== undefined
    && (typeof value.submittedAt !== "string" || Number.isNaN(Date.parse(value.submittedAt)))) return false;
  return true;
}

function publicClientError(response: Response, payload: unknown): string {
  if (response.status < 400 || response.status >= 500 || !isRecord(payload)) {
    return SUBMISSION_REQUEST_ERROR;
  }
  return payload.ok === false && isBoundedMessage(payload.error)
    ? payload.error
    : SUBMISSION_REQUEST_ERROR;
}

export async function requestMatchSubmission(
  payload: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
): Promise<SubmissionRequestResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUBMISSION_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher("/api/submissions", {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!isJsonContentType(response)) {
      return { ok: false, message: SUBMISSION_REQUEST_ERROR };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, message: SUBMISSION_REQUEST_ERROR };
    }

    if (!response.ok) {
      return { ok: false, message: publicClientError(response, body) };
    }
    return isSubmissionReceipt(body)
      ? { ok: true, message: body.message }
      : { ok: false, message: SUBMISSION_REQUEST_ERROR };
  } catch {
    return {
      ok: false,
      message: controller.signal.aborted
        ? SUBMISSION_REQUEST_TIMEOUT_ERROR
        : SUBMISSION_REQUEST_ERROR,
    };
  } finally {
    clearTimeout(timer);
  }
}
