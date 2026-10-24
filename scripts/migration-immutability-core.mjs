const migrationPath = /^drizzle\/\d+_[^/]+\.sql$/i;
const snapshotPath = /^drizzle\/meta\/\d+_snapshot\.json$/i;

export function findChangedExistingMigrations(diffOutput) {
  return diffOutput
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      const [status, path] = line.split("\t");
      if (!status || !path || !migrationPath.test(path)) return [];
      return status === "A" ? [] : [{ status, path }];
    });
}

export function findChangedExistingSnapshots(diffOutput) {
  return diffOutput
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      const [status, path] = line.split("\t");
      if (!status || !path || !snapshotPath.test(path)) return [];
      return status === "A" ? [] : [{ status, path }];
    });
}

export function isAppendOnlyMigrationJournal(baseContent, currentContent) {
  let base;
  let current;
  try {
    base = JSON.parse(baseContent);
    current = JSON.parse(currentContent);
  } catch {
    return false;
  }

  if (!base || typeof base !== "object" || !Array.isArray(base.entries)
    || !current || typeof current !== "object" || !Array.isArray(current.entries)
    || current.entries.length < base.entries.length) {
    return false;
  }

  const { entries: baseEntries, ...baseMetadata } = base;
  const { entries: currentEntries, ...currentMetadata } = current;
  if (JSON.stringify(baseMetadata) !== JSON.stringify(currentMetadata)) return false;

  for (let index = 0; index < baseEntries.length; index += 1) {
    if (JSON.stringify(baseEntries[index]) !== JSON.stringify(currentEntries[index])) return false;
  }

  for (let index = baseEntries.length; index < currentEntries.length; index += 1) {
    const entry = currentEntries[index];
    if (!entry || entry.idx !== index || typeof entry.tag !== "string" || entry.tag.length === 0) {
      return false;
    }
  }
  return true;
}
