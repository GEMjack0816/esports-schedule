import postgres from "postgres";

const requiredTables = [
  "match_submissions",
  "published_manual_matches",
  "submission_rate_limits",
  "submission_rate_limit_windows",
  "admin_audit_events",
  "pandascore_game_snapshots",
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
  if (missing.length > 0) {
    console.error(`FAIL missing required tables: ${missing.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS database reachable; ${requiredTables.length} required tables found.`);
  }
} catch {
  console.error("FAIL database connection or schema check failed.");
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 2 });
}
