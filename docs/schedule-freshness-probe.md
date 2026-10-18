# Schedule freshness probe

`GET /api/health/freshness` is a public, read-only endpoint for uptime and dead-man
monitors that need an HTTP status to represent schedule freshness:

- `200` with `status: "fresh"` only when the schedule is live, non-demo, not
  stale, and its snapshot is within the 15-minute freshness window.
- `503` with `status: "stale"` when a live snapshot is stale or its freshness
  metadata is missing/invalid.
- `503` with `status: "unavailable"` when no live snapshot is available or the
  health lookup itself fails.

Responses are `no-store` and contain only public freshness metadata. The route
uses the existing cached-only schedule read; it does not trigger PandaScore
syncs or write to the database. Configure an external uptime/dead-man service to
poll this endpoint if alerts must remain independent of GitHub Actions
scheduling. This repository change does not configure or deploy such a service.
