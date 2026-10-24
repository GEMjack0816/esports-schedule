# Migration file checksums

Drizzle records a SHA-256 checksum of each migration file's bytes in
`drizzle.__drizzle_migrations`. Git's `core.autocrlf` setting can otherwise
change those bytes on Windows checkouts and produce different journal hashes
for identical SQL.

The repository pins all files under `drizzle/` to LF line endings in
`.gitattributes`. Keep applied migration files immutable; make schema changes
with a new additive migration. A checksum difference on an already-applied
migration should be investigated against its historical file bytes and the
actual schema. Do not rerun an applied migration or edit the database journal
just to make a checksum match.

CI compares the PR or branch against its base and rejects modifications or
deletions of existing `drizzle/NNNN_*.sql` files and snapshots. The Drizzle
journal must preserve its existing metadata and entries; appended entries must
use sequential indexes, unique tags, the configured journal version, valid
breakpoint flags, and strictly increasing safe-integer timestamps. New
additive migration files are allowed.
