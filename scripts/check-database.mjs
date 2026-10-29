import postgres from "postgres";

const requiredTables = [
  "match_submissions",
  "published_manual_matches",
  "submission_rate_limits",
  "submission_rate_limit_windows",
  "admin_audit_events",
  "pandascore_game_snapshots",
  "manual_match_cache_outbox",
];
const url = process.env.DATABASE_URL?.trim();

if (!url) {
  console.error("FAIL DATABASE_URL is not configured.");
  process.exit(1);
}

const client = postgres(url, {
  max: 1,
  connect_timeout: 5,
  idle_timeout: 5,
  prepare: false,
});

try {
  await client`select 1`;
  const rows = await client`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in ${client(requiredTables)}
  `;
  const present = new Set(rows.map((row) => row.table_name));
  const missing = requiredTables.filter((table) => !present.has(table));
  const [fencingColumn] = await client`
    select data_type, is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pandascore_game_snapshots'
      and column_name = 'fencing_generation'
  `;
  const [generationSequence] = await client`
    select 1 as present
    from pg_class
    join pg_namespace on pg_namespace.oid = pg_class.relnamespace
    where pg_namespace.nspname = 'public'
      and pg_class.relkind = 'S'
      and pg_class.relname = 'pandascore_sync_generation_seq'
  `;
  const [manualCacheSequence] = await client`
    select 1 as present
    from pg_class
    join pg_namespace on pg_namespace.oid = pg_class.relnamespace
    where pg_namespace.nspname = 'public'
      and pg_class.relkind = 'S'
      and pg_class.relname = 'manual_match_cache_revision_seq'
  `;
  const [operationKey] = await client`
    select data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'published_manual_matches'
      and column_name = 'operation_key'
  `;
  const [cacheRetryColumn] = await client`
    select data_type, is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'manual_match_cache_outbox'
      and column_name = 'retry_after'
  `;
  if (missing.length > 0) {
    console.error(`FAIL missing required tables: ${missing.join(", ")}`);
    process.exitCode = 1;
  } else if (fencingColumn?.data_type !== "bigint" || fencingColumn?.is_nullable !== "NO") {
    console.error("FAIL pandascore_game_snapshots.fencing_generation is missing or invalid.");
    process.exitCode = 1;
  } else if (!generationSequence) {
    console.error("FAIL pandascore_sync_generation_seq is missing.");
    process.exitCode = 1;
  } else if (!manualCacheSequence || operationKey?.data_type !== "uuid") {
    console.error("FAIL manual match cache revision or idempotency schema is missing.");
    process.exitCode = 1;
  } else if (cacheRetryColumn?.data_type !== "timestamp with time zone"
    || cacheRetryColumn?.is_nullable !== "YES") {
    console.error("FAIL manual_match_cache_outbox.retry_after is missing or invalid.");
    process.exitCode = 1;
  } else {
    console.log(`PASS database reachable; ${requiredTables.length} required tables, sync fencing, and cache retry schema found.`);
  }
} catch {
  console.error("FAIL database connection or schema check failed.");
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 2 });
}

