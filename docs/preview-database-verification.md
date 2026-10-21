# Preview database target verification

`GET /api/health/data-coverage` adds `database.targetFingerprint` only when
`VERCEL_ENV=preview`. Production responses do not include this field.

The fingerprint is a SHA-256 equality-check value over the lowercase PostgreSQL hostname, normalized
port, a NUL byte, and the decoded database name. It is **not a secret or a
confidentiality control**: anyone who knows or guesses a candidate endpoint and
database name can compute a matching value. Keep returning it only to an
authenticated Preview admin; never use it as authorization. An omitted port is normalized
to `PGPORT` when set, otherwise PostgreSQL's default `5432`. For Neon hosts, the
`-pooler` hostname suffix is normalized away because pooled and direct URIs
address the same endpoint. It excludes the username, password, query parameters,
and URL fragment. A `null` fingerprint means the URL is missing, malformed, or
not a PostgreSQL URL; it does not imply that the database is unreachable. Use
the separate `database.status` field for connectivity.

To verify a protected Preview without exposing `DATABASE_URL`:

1. Open `/api/health/data-coverage` in a Vercel-authenticated browser and note
   `database.targetFingerprint` and `database.status`.
2. In Neon, open the intended Preview project's endpoint details and note its
   endpoint hostname and database name (`neondb` for the current integration
   Preview).
3. Compare locally without printing either value:

   ```bash
   npm run verify:preview-db-target -- <fingerprint-from-health> <neon-endpoint-hostname> neondb [port]
   ```

   The command prints only PASS or FAIL. Never copy the connection URL,
   username, or password into logs, chat, or this repository. Omit `port` when
   the connection uses PostgreSQL's default `5432`; otherwise pass the actual
   endpoint port (including a `PGPORT` override, if configured).

This is an identity comparison, not an authentication mechanism. Continue to
rely on Deployment Protection and database credentials for access control.

