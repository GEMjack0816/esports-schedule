const migrationPath = /^drizzle\/\d+_[^/]+\.sql$/i;

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
