# PandaScore Runtime Cache payloads

PostgreSQL remains the complete Last-Known-Good snapshot store. Runtime Cache is an optional fast layer; neither cache size nor compression changes match filtering, pagination, deduplication, fencing generation, timestamps, or the public response shape.

## Size handling

Vercel documents a 2 MB per-item Runtime Cache limit ([API reference](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package)). `cache-payload.ts` uses a conservative 1,800,000-byte JSON budget, including base64 envelope overhead.

- Small snapshots retain the existing plain-object format.
- Larger snapshots use asynchronous gzip level 1 plus base64. The entire match list and metadata round-trip without truncation.
- If the encoded item still exceeds the budget, no cache write is attempted. The existing writer returns `false`, the sync result includes its existing `CACHE_WRITE` diagnostic, and the complete PostgreSQL snapshot remains available.
- A bounded preflight counts JSON UTF-8 bytes before `JSON.stringify` allocates a serialized copy. Snapshots above 16 MiB, with more than 250,000 JSON nodes, or with unsupported object shapes skip the optional Runtime Cache write. This bounds codec work; it is **not** a database or schedule-size cap.
- Decoding validates format, canonical base64 and declared output size. Actual decompression is bounded by `maxOutputLength`, at most 16 MiB. Bad or oversized data is a cache miss; the normal persistent recovery path applies.
- Decompression is followed by the existing snapshot/game/status validation. No payload, parser error or token is logged.

## Compatibility and limits

There is no schema change, new dependency, environment variable, real upstream request or migration. Existing plain cache entries remain readable. Older deployed code cannot decode the compressed envelope, but treats it as an invalid cache entry and uses the already available persistent recovery path. No destructive cache purge is required.

This change does not bound upstream JSON ingestion or the persistent JSONB store itself. A snapshot that exceeds the codec budget can require repeated PostgreSQL reads; this remains an observable `CACHE_WRITE` condition, not a successful cache write. Do not claim arbitrary dataset sizes are supported at constant memory/latency.

## Verification

`npm test -- src/lib/schedule/cache-payload.test.ts` covers exact escaped/Unicode byte accounting, rejection before full serialization, unsupported/cyclic objects, large lossless round-trips, incompressible data, oversized decoded input, corrupt envelopes, invalid base64, decompression expansion, and post-decode schema/game validation.

The existing isolated PostgreSQL CI service additionally exercises a 6,000-match persistent recovery and an over-budget snapshot retained in full. Tests do not call PandaScore or any live database. CI also runs migrations, `db:check`, TypeScript, ESLint, build and the client credential scan.
