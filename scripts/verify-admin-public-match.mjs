export function assertVerificationScheduleMatch(payload, expected) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("public schedule response is invalid");
  }
  if (payload.mode !== "live" || payload.demoMode !== false) {
    throw new Error("public schedule is not live non-demo data");
  }
  if (!Array.isArray(payload.matches)) {
    throw new Error("public schedule match list is invalid");
  }
  if (typeof expected?.shouldExist !== "boolean") {
    throw new Error("expected public match state is invalid");
  }

  let matches;
  if (typeof expected.matchId === "string" && expected.matchId.length > 0) {
    matches = payload.matches.filter((match) => match?.id === expected.matchId);
  } else if (
    typeof expected.teamA === "string" && expected.teamA.length > 0
    && typeof expected.teamB === "string" && expected.teamB.length > 0
  ) {
    matches = payload.matches.filter((match) =>
      (match?.homeTeam?.name === expected.teamA && match?.awayTeam?.name === expected.teamB)
      || (match?.homeTeam?.name === expected.teamB && match?.awayTeam?.name === expected.teamA),
    );
  } else {
    throw new Error("expected public match identity is invalid");
  }

  if (!expected.shouldExist) {
    if (matches.length !== 0) throw new Error("public match should be hidden");
    return null;
  }
  if (matches.length !== 1) throw new Error("public match is missing or duplicated");
  if (expected.league !== undefined && matches[0].league !== expected.league) {
    throw new Error("public match edit is not visible");
  }
  return matches[0];
}
