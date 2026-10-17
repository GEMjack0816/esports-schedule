import { requireAdminApi } from "@/lib/auth/admin-page";
import { trustedMutationOrigin } from "@/lib/auth/vercel";
import { getPreviewDatabaseTargetFingerprint } from "@/db/identity";
import { cleanupVerificationRun } from "@/lib/review/service";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" };
const MAX_BODY_BYTES = 1_024;
const MAX_BODY_CHUNKS = 64;
const BODY_READ_TIMEOUT_MS = 5_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATABASE_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/i;

class CleanupRequestError extends Error {
  constructor(readonly status: 400 | 408 | 413) {
    super("Invalid cleanup request body.");
  }
}

async function readBoundedBody(request: Request): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) throw new CleanupRequestError(400);
    if (Number(contentLength) > MAX_BODY_BYTES) throw new CleanupRequestError(413);
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let chunkCount = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new CleanupRequestError(408)), BODY_READ_TIMEOUT_MS);
  });
  const aborted = new Promise<never>((_, reject) => {
    abortHandler = () => reject(new CleanupRequestError(408));
    if (request.signal.aborted) abortHandler();
    else request.signal.addEventListener("abort", abortHandler, { once: true });
  });

  try {
    while (true) {
      const result = await Promise.race([reader.read(), deadline, aborted]);
      if (result.done) break;
      chunkCount += 1;
      totalBytes += result.value.byteLength;
      if (totalBytes > MAX_BODY_BYTES || chunkCount > MAX_BODY_CHUNKS) {
        throw new CleanupRequestError(413);
      }
      chunks.push(result.value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof CleanupRequestError) throw error;
    throw new CleanupRequestError(400);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (abortHandler) request.signal.removeEventListener("abort", abortHandler);
    try {
      reader.releaseLock();
    } catch {
      // A timed-out read may still be settling after cancellation.
    }
  }
}

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") {
    return Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  try {
    trustedMutationOrigin(request);
  } catch {
    return Response.json({ error: "请求来源无效。" }, { status: 403, headers: NO_STORE });
  }

  try {
    const bodyText = await readBoundedBody(request);
    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return Response.json({ error: "请求格式无效。" }, { status: 400, headers: NO_STORE });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "请求格式无效。" }, { status: 400, headers: NO_STORE });
    }
    const bodyRecord = body as Record<string, unknown>;
    const runId = bodyRecord.runId;
    if (typeof runId !== "string" || !UUID_PATTERN.test(runId)) {
      return Response.json({ error: "验证运行标识无效。" }, { status: 400, headers: NO_STORE });
    }
    const expectedFingerprint = bodyRecord.expectedDatabaseFingerprint;
    const actualFingerprint = getPreviewDatabaseTargetFingerprint();
    if (
      typeof expectedFingerprint !== "string"
      || !DATABASE_FINGERPRINT_PATTERN.test(expectedFingerprint)
      || !actualFingerprint
      || actualFingerprint.toLowerCase() !== expectedFingerprint.toLowerCase()
    ) {
      return Response.json({ ok: false, error: "Preview 验证数据库身份未通过检查。" }, {
        status: 503,
        headers: NO_STORE,
      });
    }

    let counts;
    try {
      counts = await cleanupVerificationRun(runId.toLowerCase());
    } catch {
      return Response.json({ ok: false, error: "Preview 验证数据清理失败。" }, {
        status: 503,
        headers: NO_STORE,
      });
    }
    return Response.json({ ok: true, runId: runId.toLowerCase(), counts }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof CleanupRequestError) {
      const errorMessage = error.status === 413
        ? "请求内容过大。"
        : error.status === 408
          ? "读取请求超时。"
          : "请求格式无效。";
      return Response.json({ error: errorMessage }, { status: error.status, headers: NO_STORE });
    }
    return Response.json({ error: "请求格式无效。" }, { status: 400, headers: NO_STORE });
  }
}
