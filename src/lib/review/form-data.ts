import "server-only";

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "");
}

function nullable(form: FormData, key: string): string | null {
  const value = text(form, key).trim();
  return value || null;
}

export function submissionFromForm(form: FormData) {
  return {
    game: text(form, "submission.game"),
    league: text(form, "submission.league"),
    teamA: text(form, "submission.teamA"),
    teamB: text(form, "submission.teamB"),
    scheduledAt: text(form, "submission.scheduledAt"),
    bestOf: nullable(form, "submission.bestOf"),
    sourceUrl: text(form, "submission.sourceUrl"),
    notes: nullable(form, "submission.notes"),
  };
}

export function publishedFromForm(form: FormData) {
  const prefix = "published.";
  return {
    game: text(form, `${prefix}game`),
    league: text(form, `${prefix}league`),
    tournament: nullable(form, `${prefix}tournament`),
    stage: nullable(form, `${prefix}stage`),
    homeTeamName: text(form, `${prefix}homeTeamName`),
    homeTeamAcronym: nullable(form, `${prefix}homeTeamAcronym`),
    homeTeamLogo: nullable(form, `${prefix}homeTeamLogo`),
    awayTeamName: text(form, `${prefix}awayTeamName`),
    awayTeamAcronym: nullable(form, `${prefix}awayTeamAcronym`),
    awayTeamLogo: nullable(form, `${prefix}awayTeamLogo`),
    startTimeUtc: nullable(form, `${prefix}startTimeUtc`),
    bestOf: nullable(form, `${prefix}bestOf`),
    status: text(form, `${prefix}status`),
    homeScore: nullable(form, `${prefix}homeScore`),
    awayScore: nullable(form, `${prefix}awayScore`),
    streamUrl: nullable(form, `${prefix}streamUrl`),
    sourceUrl: nullable(form, `${prefix}sourceUrl`),
  };
}
