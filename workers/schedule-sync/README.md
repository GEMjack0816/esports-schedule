# Independent schedule sync scheduler (optional)

This Worker is an independent, best-effort backup trigger for the existing protected Vercel sync endpoint. It does not fetch PandaScore directly, access PostgreSQL, or change the site's sync implementation. The Vercel database lock and fencing generation remain authoritative.

The schedule is `5,20,35,50 * * * *` UTC, intentionally offset from the current GitHub workflow at `*/15 * * * *`. If the GitHub workflow cadence changes, re-check the two schedules for overlap. Either scheduler may miss or delay an invocation; this Worker does **not** establish a hard 15-minute freshness SLA.

## Cloudflare capacity check before deployment

The current configuration contains one Cron expression with four scheduled times per hour (96 invocations/day). A run normally makes one health probe and one sync request. Explicit 429 responses can cause at most two bounded retries; an ambiguous sync response can cause one additional health reconciliation request, so the conservative upper bound is five outbound requests per invocation (up to 480/day). This is only the Worker's upper bound and does not account for other Workers using the account quota. Before deployment, verify the actual account plan and remaining account-level capacity in Cloudflare:

- Workers Free currently documents 100,000 requests/day, up to 5 Cron Triggers per account, and 10 ms CPU time per Cron invocation. Confirm the account has an available trigger slot and that measured CPU stays within its plan limit; network wait time is separate from CPU time. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
- Cron execution is best-effort and runs on UTC; adding or changing a trigger may take up to 15 minutes to propagate. Do not treat this schedule as a freshness SLA. See [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
- The handler has a 14-minute internal wall-time budget, below Cloudflare's 15-minute Cron invocation wall-time ceiling. Keep the total budget bounded if request or retry limits change.

Before invoking the authenticated sync endpoint, the Worker requires its configured secret and makes a bounded, unauthenticated, no-store request to the public data-coverage health endpoint. It skips the sync only when the response confirms live non-demo data, a fresh snapshot within the application's 15-minute window, no refresh in progress, and normal status for all five games. If the health request fails, is malformed, or cannot prove every condition, the Worker proceeds with one authenticated sync attempt; the health check is only a duplicate-work optimization, never a reason to suppress recovery.

The Worker has no public HTTP route (`workers_dev` is disabled). Its only configuration is a Cron Trigger. It sends an authenticated `GET` to the existing production sync endpoint with the bearer secret in the `Authorization` header, never in the URL. Logs contain only a sanitized result summary and never the response body, request headers, or secret.

Retries are bounded and limited to explicit HTTP 429 rejections, which honor `Retry-After` when present. A completed structured `failed` or `not-configured` response is terminal for that invocation and is not immediately resubmitted. Network errors, 5xx responses, and unreadable response bodies are ambiguous because the Vercel sync may have completed before its response was lost; the Worker never blindly replays them. Instead, it makes one no-store health probe and treats the invocation as recovered only if all five games are fresh and `lastSuccessfulSyncAt` advanced beyond the pre-sync baseline. Otherwise it fails closed and relies on a later scheduled trigger. This avoids duplicate PandaScore calls while preserving a clear failure signal.

## Not deployed by this repository change

Do not deploy until an operator has confirmed a Cloudflare account and can securely configure the exact existing Production `CRON_SECRET` from its authorized source. Vercel does not reveal Sensitive values. Do not retrieve, print, copy into chat, or place the value in a file. If the existing value is unavailable, stop and obtain explicit authorization for a coordinated secret update; do not rotate it as part of this Worker change.

After that prerequisite is satisfied, configure `CRON_SECRET` as a Worker secret using the Cloudflare dashboard or `wrangler secret put CRON_SECRET`, then deploy this directory with Wrangler. Configure the secret directly in Wrangler's secure prompt/input; never pass its value as a command argument. Verify the scheduled Worker reports `success` or `partial` outcomes and that Vercel's existing health endpoint later reflects the refreshed snapshot. A `skipped_busy` invocation is logged distinctly because another sync owns the application lock; it is not evidence that this invocation refreshed data.

## Local tests

The Worker uses only Web APIs and Node built-ins, so the repository's Vitest suite tests its request validation, bounded retries, secret handling, and business outcomes without Cloudflare credentials or any network call.
