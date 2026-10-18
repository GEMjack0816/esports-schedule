# Independent schedule sync scheduler (optional)

This Worker is an independent, best-effort backup trigger for the existing protected Vercel sync endpoint. It does not fetch PandaScore directly, access PostgreSQL, or change the site's sync implementation. The Vercel database lock and fencing generation remain authoritative.

The schedule is `5,20,35,50 * * * *` UTC, intentionally offset from the current GitHub workflow at `*/15 * * * *`. If the GitHub workflow cadence changes, re-check the two schedules for overlap. Either scheduler may miss or delay an invocation; this Worker does **not** establish a hard 15-minute freshness SLA.

The Worker has no public HTTP route (`workers_dev` is disabled). Its only configuration is a Cron Trigger. It sends an authenticated `GET` to the existing production sync endpoint with the bearer secret in the `Authorization` header, never in the URL. Logs contain only a sanitized result summary and never the response body, request headers, or secret.

## Not deployed by this repository change

Do not deploy until an operator has confirmed a Cloudflare account and can securely configure the exact existing Production `CRON_SECRET` from its authorized source. Vercel does not reveal Sensitive values. Do not retrieve, print, copy into chat, or place the value in a file. If the existing value is unavailable, stop and obtain explicit authorization for a coordinated secret update; do not rotate it as part of this Worker change.

After that prerequisite is satisfied, configure `CRON_SECRET` as a Worker secret using the Cloudflare dashboard or `wrangler secret put CRON_SECRET`, then deploy this directory with Wrangler. Configure the secret directly in Wrangler's secure prompt/input; never pass its value as a command argument. Verify the scheduled Worker reports `success` or `partial` outcomes and that Vercel's existing health endpoint later reflects the refreshed snapshot. A `skipped_busy` invocation is logged distinctly because another sync owns the application lock; it is not evidence that this invocation refreshed data.

## Local tests

The Worker uses only Web APIs and Node built-ins, so the repository's Vitest suite tests its request validation, bounded retries, secret handling, and business outcomes without Cloudflare credentials or any network call.
