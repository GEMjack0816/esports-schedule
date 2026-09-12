import type { SchedulePayload } from "./types";

// This fetch reads the existing schedule endpoint; it never calls PandaScore.
export const SCHEDULE_REFRESH_TIMEOUT_MS = 15_000;
export const SCHEDULE_REFRESH_ERROR = "刷新失败，已保留当前赛程。请稍后重试。";

export async function requestScheduleRefresh(fetcher: typeof fetch = fetch): Promise<
  { ok: true; payload: SchedulePayload } | { ok: false }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCHEDULE_REFRESH_TIMEOUT_MS);
  try {
    const response = await fetcher("/api/matches", { cache: "no-store", signal: controller.signal });
    if (!response.ok) return { ok: false };
    const payload = await response.json() as SchedulePayload;
    return { ok: true, payload };
  } catch {
    // Never display transport errors or response bodies, which can contain
    // infrastructure details. The caller retains its last rendered payload.
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}
