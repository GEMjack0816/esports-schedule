import "server-only";

import { createHash } from "node:crypto";

/** Fingerprints only the destination identity; credentials and URL options are excluded. */
export function fingerprintDatabaseTarget(databaseUrl: string | undefined): string | null {
  if (!databaseUrl?.trim()) return null;
  try {
    const url = new URL(databaseUrl.trim());
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return null;
    const hostname = url.hostname.toLowerCase();
    const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (!hostname || !databaseName) return null;
    return createHash("sha256")
      .update(`${hostname}\0${databaseName}`, "utf8")
      .digest("hex");
  } catch {
    return null;
  }
}

/** Never include the database destination fingerprint in Production responses. */
export function getPreviewDatabaseTargetFingerprint(): string | null {
  if (process.env.VERCEL_ENV !== "preview") return null;
  return fingerprintDatabaseTarget(process.env.DATABASE_URL);
}
