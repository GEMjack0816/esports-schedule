export function resolveExpectedCommitSha(argument, environmentValue) {
  const fromArgument = argument?.trim() || null;
  const fromEnvironment = environmentValue?.trim() || null;

  if (fromArgument && fromEnvironment && fromArgument.toLowerCase() !== fromEnvironment.toLowerCase()) {
    throw new Error("expected commit SHA argument conflicts with EXPECTED_GIT_COMMIT_SHA");
  }

  const expected = fromArgument || fromEnvironment;
  if (expected && !/^[a-f0-9]{40}$/i.test(expected)) {
    throw new Error("expected commit SHA must be a full 40-character hexadecimal SHA");
  }

  return expected?.toLowerCase() ?? null;
}

export function matchesExpectedCommitSha(expectedSha, fingerprints) {
  if (!expectedSha) return true;
  return [fingerprints.homepage, fingerprints.version, fingerprints.health]
    .every((sha) => typeof sha === "string" && sha.toLowerCase() === expectedSha);
}
