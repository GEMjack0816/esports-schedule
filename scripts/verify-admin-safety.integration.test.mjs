import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupVerifyAdminData } from "./verify-admin-safety.mjs";

const databaseUrl = process.env.REVIEW_TEST_DATABASE_URL?.trim();
let isIsolatedCiDatabase = false;
try {
  const parsed = new URL(databaseUrl);
  isIsolatedCiDatabase = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    && parsed.pathname === "/esports_schedule_ci";
} catch {
  // Missing and malformed URLs disable the test without attempting a connection.
}
const enabled = process.env.ALLOW_REVIEW_DATABASE_TESTS === "1" && isIsolatedCiDatabase;

describe.skipIf(!enabled)("verify:admin cleanup against isolated PostgreSQL", () => {
  let client;
  let league;

  afterEach(async () => {
    if (!client) return;
    const activeClient = client;
    try {
      if (league) await cleanupVerifyAdminData(activeClient, league, async (id) => {
        await activeClient`update published_manual_matches set hidden = true where id = ${id}::uuid`;
      });
    } finally {
      await activeClient.end({ timeout: 2 });
    }
    client = undefined;
    league = undefined;
  });

  it("atomically removes only the run-marked submissions, published match, and audit rows", async () => {
    client = postgres(databaseUrl, { max: 1, connect_timeout: 5, prepare: false });
    league = `Codex isolated review integration ${randomUUID()}`;

    const [approved] = await client`
      insert into match_submissions
        (game, league, team_a, team_b, scheduled_at, source_url, status, fingerprint)
      values
        ('honor-of-kings', ${league}, 'Approved Alpha', 'Approved Beta', now(),
         'https://example.com/verify-admin', 'approved', ${randomUUID()})
      returning id
    `;
    const [rejected] = await client`
      insert into match_submissions
        (game, league, team_a, team_b, scheduled_at, source_url, status, fingerprint)
      values
        ('honor-of-kings', ${league}, 'Rejected Alpha', 'Rejected Beta', now(),
         'https://example.com/verify-admin', 'rejected', ${randomUUID()})
      returning id
    `;
    const [manualMatch] = await client`
      insert into published_manual_matches
        (source_submission_id, game, league, home_team_name, away_team_name, published_by)
      values
        (${approved.id}, 'honor-of-kings', ${`${league} edited`}, 'Approved Alpha', 'Approved Beta', 'integration-test')
      returning id
    `;
    await client`
      insert into admin_audit_events (actor_id, action, entity_type, entity_id)
      values
        ('integration-test', 'submission.approved', 'submission', ${approved.id}),
        ('integration-test', 'submission.rejected', 'submission', ${rejected.id}),
        ('integration-test', 'manual_match.edited', 'manual_match', ${manualMatch.id})
    `;

    await cleanupVerifyAdminData(client, league, async (id) => {
      await client`update published_manual_matches set hidden = true where id = ${id}::uuid`;
    });

    const [remainingSubmissions] = await client`
      select count(*)::int as count from match_submissions where league = ${league}
    `;
    const [remainingMatches] = await client`
      select count(*)::int as count from published_manual_matches
      where league = ${league} or league = ${`${league} edited`}
        or source_submission_id = any(${[approved.id, rejected.id]}::uuid[])
    `;
    const [remainingAudit] = await client`
      select count(*)::int as count from admin_audit_events
      where entity_id = any(${[approved.id, rejected.id, manualMatch.id]}::uuid[])
    `;

    expect(remainingSubmissions.count).toBe(0);
    expect(remainingMatches.count).toBe(0);
    expect(remainingAudit.count).toBe(0);
  });
});

