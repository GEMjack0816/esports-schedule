import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { requestSync } from "./trigger-sync.mjs";

const secret = "test-cron-secret-never-log";
const workflow = readFileSync(new URL("../.github/workflows/sync-schedule.yml", import.meta.url), "utf8");

function jsonResponse(payload, { status = 200, contentType = "application/json" } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": contentType },
  });
}

describe("production sync request boundary", () => {
  it("runs one bounded Node request without curl retries or a response temp file", () => {
    expect(workflow).toContain("CRON_SECRET: ${{ secrets.CRON_SECRET }}");
    expect(workflow).toMatch(/node scripts\/trigger-sync\.mjs/);
    expect(workflow).not.toMatch(/\bcurl\b|--retry|response_file|SYNC_URL:/);
    expect(workflow).not.toMatch(/echo\s+.*CRON_SECRET/);
  });

  it("prevents non-main manual dispatches from accessing the production sync credential", () => {
    expect(workflow).toMatch(/\bif:\s*github\.ref\s*==\s*['"]refs\/heads\/main['"]/);
  });

  it("sends one fixed-target request with the secret only in the authorization header", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: "busy" }, { status: 409 }));
    const timeoutSignal = new AbortController().signal;
    const timeoutSignalImpl = vi.fn(() => timeoutSignal);

    await expect(requestSync({
      env: { CRON_SECRET: secret },
      fetchImpl,
      timeoutSignalImpl,
    })).resolves.toMatchObject({ httpStatus: 409, payload: { status: "busy" } });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://esports-schedule-two.vercel.app/api/cron/sync",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ authorization: `Bearer ${secret}` }),
        redirect: "error",
        signal: timeoutSignal,
      }),
    );
    expect(timeoutSignalImpl).toHaveBeenCalledWith(300_000);
  });

  it("fails without making a request when the secret is missing", async () => {
    const fetchImpl = vi.fn();
    await expect(requestSync({ env: {}, fetchImpl })).rejects.toMatchObject({
      code: "missing_configuration",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("bounds the response body before parsing it", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(32 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await expect(requestSync({ env: { CRON_SECRET: secret }, fetchImpl })).rejects.toMatchObject({
      code: "response_too_large",
    });
    expect(cancelled).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("bounds response chunk count even when chunks contain no bytes", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        for (let index = 0; index < 1_025; index += 1) controller.enqueue(new Uint8Array());
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await expect(requestSync({ env: { CRON_SECRET: secret }, fetchImpl })).rejects.toMatchObject({
      code: "response_too_many_chunks",
    });
    expect(cancelled).toBe(true);
  });

  it("rejects non-JSON responses without exposing their body", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(secret));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = vi.fn(async () => new Response(body, {
      status: 502,
      headers: { "content-type": "text/plain" },
    }));

    await expect(requestSync({ env: { CRON_SECRET: secret }, fetchImpl })).rejects.toMatchObject({
      code: "invalid_content_type",
    });
    expect(cancelled).toBe(true);
  });

  it("does not retry ambiguous network failures that could duplicate a completed sync", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error(secret); });

    const error = await requestSync({ env: { CRON_SECRET: secret }, fetchImpl }).catch((value) => value);
    expect(error).toMatchObject({ code: "network_or_timeout_failure" });
    expect(error.message).not.toContain(secret);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
