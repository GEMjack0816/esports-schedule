import "server-only";

import { createHash } from "node:crypto";

function normalizeDatabaseHostname(hostname: string): string {
  const normalized = hostname.toLowerCase();
  if (!normalized.endsWith(".neon.tech")) return normalized;

  const firstDot = normalized.indexOf(".");
  const endpointLabel = firstDot === -1 ? normalized : normalized.slice(0, firstDot);
  if (!endpointLabel.startsWith("ep-") || !endpointLabel.endsWith("-pooler")) {
    return normalized;
  }

  return `${endpointLabel.slice(0, -"-pooler".length)}${normalized.slice(firstDot)}`;
}

/**
 * Returns a stable, non-reversible fingerprint of the database destination.
 * Credentials, query parameters, and URL fragments are intentionally excluded.
 */
export function fingerprintDatabaseTarget(databaseUrl: string | undefined): string | null {
  if (!databaseUrl?.trim()) return null;

  try {
    const url = new URL(databaseUrl.trim());
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return null;

    // Neon adds `-pooler` to the same endpoint hostname for pooled URIs.
    // Normalize that transport-only suffix so direct and pooled URLs identify
    // the same database target.
    const hostname = normalizeDatabaseHostname(url.hostname);
    const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (!hostname || !databaseName) return null;

    return createHash("sha256")
      .update(`${hostname}\0${databaseName}`, "utf8")
      .digest("hex");
  } catch {
    return null;
  }
}

/**
 * Expose target verification only on Preview deployments, never in Production.
 */
export function getPreviewDatabaseTargetFingerprint(): string | null {
  if (process.env.VERCEL_ENV !== "preview") return null;
  return fingerprintDatabaseTarget(process.env.DATABASE_URL);
}

