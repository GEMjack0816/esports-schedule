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
export function fingerprintDatabaseTarget(
  databaseUrl: string | undefined,
  fallbackPort = "5432",
): string | null {
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

    // PostgreSQL endpoints can expose distinct servers on different ports.
    // Normalize an omitted port to the driver's PostgreSQL default so an
    // explicit `:5432` and an omitted port identify the same destination.
    const port = normalizeDatabasePort(url.port || fallbackPort || "5432");
    if (!port) return null;

    return createHash("sha256")
      .update(`${hostname}:${port}\0${databaseName}`, "utf8")
      .digest("hex");
  } catch {
    return null;
  }
}

function normalizeDatabasePort(value: string): string | null {
  if (!/^\d{1,5}$/.test(value)) return null;
  const port = Number(value);
  return port >= 1 && port <= 65535 ? String(port) : null;
}

/**
 * Expose target verification only on Preview deployments, never in Production.
 */
export function getPreviewDatabaseTargetFingerprint(): string | null {
  if (process.env.VERCEL_ENV !== "preview") return null;
  return fingerprintDatabaseTarget(process.env.DATABASE_URL, process.env.PGPORT);
}

