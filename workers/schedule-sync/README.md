# Independent schedule sync scheduler (optional)

This Worker is an independent, best-effort backup trigger for the existing protected Vercel sync endpoint. It does not fetch PandaScore directly, access PostgreSQL, or change the site's sync implementation. The Vercel database lock and fencing generation remain authoritative.

The schedule is `5,20,35,50 * * * *` UTC, intentionally offset from the current GitHub workflow at `*/15 * * * *`. If the GitHub workflow cadence changes, re-check the two schedules for overlap. Either scheduler may miss or delay an invocation; this Worker does **not** establish a hard 15-minute freshness SLA.

## Cloudflare capacity check before deployment

The current configuration contains one Cron expression with four scheduled times per hour (96 invocations/day). With the health probe and at most three bounded sync attempts, the Worker can make at most four outbound requests per invocation (up to 384/day); this is only the Worker's upper bound and does not account for other Workers using the account quota. Before deployment, verify the actual account plan and remaining account-level capacity in Cloudflare:

- Workers Free currently documents 100,000 requests/day, up to 5 Cron Triggers per account, and 10 ms CPU time per Cron invocation. Confirm the account has an available trigger slot and that measured CPU stays within its plan limit; network wait time is separate from CPU time. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
- Cron execution is best-effort and runs on UTC; adding or changing a trigger may take up to 15 minutes to propagate. Do not treat this schedule as a freshness SLA. See [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
- The handler has a 14-minute internal wall-time budget, below Cloudflare's 15-minute Cron invocation wall-time ceiling. Keep the total budget bounded if request or retry limits change.

Before invoking the authenticated sync endpoint, the Worker makes a bounded, unauthenticated, no-store request to the public data-coverage health endpoint. It skips the sync only when the response confirms live non-demo data, a fresh snapshot no older than 10 minutes, no refresh in progress, and normal status for all five games. This five-minute guard band is deliberately below both the application's 15-minute freshness window and the Worker’s 15-minute trigger interval: if GitHub misses a run, the next Worker invocation will not skip at the stale boundary and wait another interval. If the health request fails, is malformed, or cannot prove every condition, the Worker proceeds with the bounded sync attempt; the health check is only a duplicate-work optimization, never a reason to suppress recovery. Cron delivery and sync duration remain best-effort, not a hard SLA.

The Worker has no public HTTP route (`workers_dev` is disabled). Its only configuration is a Cron Trigger. It sends an authenticated `GET` to the existing production sync endpoint with the bearer secret in the `Authorization` header, never in the URL. Logs contain only a sanitized result summary and never the response body, request headers, or secret.

Retries are bounded. A completed structured `failed` or `not-configured` response is terminal for that invocation and is not immediately resubmitted, avoiding amplification of provider throttling or database outages. Unstructured transient 5xx responses retain the bounded retry policy.

## Not deployed by this repository change

Do not deploy until an operator has confirmed a Cloudflare account and can securely configure the exact existing Production `CRON_SECRET` from its authorized source. Vercel does not reveal Sensitive values. Do not retrieve, print, copy into chat, or place the value in a file. If the existing value is unavailable, stop and obtain explicit authorization for a coordinated secret update; do not rotate it as part of this Worker change.

After that prerequisite is satisfied, configure `CRON_SECRET` as a Worker secret using the Cloudflare dashboard or `wrangler secret put CRON_SECRET`, then deploy this directory with Wrangler. Configure the secret directly in Wrangler's secure prompt/input; never pass its value as a command argument. Verify the scheduled Worker reports `success` or `partial` outcomes and that Vercel's existing health endpoint later reflects the refreshed snapshot. A `skipped_busy` invocation is logged distinctly because another sync owns the application lock; it is not evidence that this invocation refreshed data.

## Local tests

The Worker uses only Web APIs and Node built-ins, so the repository's Vitest suite tests its request validation, bounded retries, secret handling, and business outcomes without Cloudflare credentials or any network call.
