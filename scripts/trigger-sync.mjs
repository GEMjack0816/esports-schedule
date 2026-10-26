import { pathToFileURL } from "node:url";
import { validateSyncResponse } from "./validate-sync-response.mjs";

const SYNC_URL = "https://esports-schedule-two.vercel.app/api/cron/sync";
const MAX_RESPONSE_BYTES = 32 * 1024;
const REQUEST_TIMEOUT_MS = 300_000;

class SyncRequestError extends Error {
  constructor(code) {
    super(code);
    this.name = "SyncRequestError";
    this.code = code;
  }
}

function cancelReaderWithoutBlocking(reader) {
  try {
    void reader.cancel().catch(() => {});
  } catch {
    // Cancellation is best-effort; failure must not replace the bounded error.
  }
}

function cancelBodyWithoutBlocking(body) {
  try {
    void body?.cancel().catch(() => {});
  } catch {
    // Cancellation is best-effort; failure must not replace the bounded error.
  }
}

async function readJsonBody(response) {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
    cancelBodyWithoutBlocking(response.body);
    throw new SyncRequestError("invalid_content_type");
  }
  if (!response.body) throw new SyncRequestError("missing_response_body");

  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  let chunkCount = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunkCount += 1;
      if (chunkCount > 1_024) {
        cancelReaderWithoutBlocking(reader);
        throw new SyncRequestError("response_too_many_chunks");
      }
      byteLength += value.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        cancelReaderWithoutBlocking(reader);
        throw new SyncRequestError("response_too_large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof SyncRequestError) throw error;
    throw new SyncRequestError("response_read_failed");
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new SyncRequestError("invalid_json");
  }
}

export async function requestSync({
  env = process.env,
  fetchImpl = fetch,
  timeoutSignalImpl = AbortSignal.timeout,
  nowImpl = Date.now,
} = {}) {
  const secret = env.CRON_SECRET;
  if (typeof secret !== "string" || secret.length === 0) {
    throw new SyncRequestError("missing_configuration");
  }

  const requestStartedAt = nowImpl();
  let response;
  try {
    response = await fetchImpl(SYNC_URL, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${secret}`,
        "cache-control": "no-store",
      },
      redirect: "error",
      signal: timeoutSignalImpl(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SyncRequestError("network_or_timeout_failure");
  }

  return {
    httpStatus: response.status,
    payload: await readJsonBody(response),
    requestStartedAt,
  };
}

async function main() {
  try {
    const { httpStatus, payload, requestStartedAt } = await requestSync();
    const result = validateSyncResponse(payload, httpStatus, Date.now(), requestStartedAt);
    console.log(result.message);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    const code = error instanceof SyncRequestError ? error.code : "sync_request_failed";
    console.error(`sync request failed (${code})`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
