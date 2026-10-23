type VercelDeploymentIdentity = {
  VERCEL_ENV?: string;
  VERCEL_GIT_COMMIT_REF?: string;
  VERCEL_GIT_COMMIT_SHA?: string;
  VERCEL_DEPLOYMENT_ID?: string;
  VERCEL_URL?: string;
  DATABASE_URL?: string;
  ADMIN_VERIFY_PREVIEW_DATABASE_HOSTS?: string;
};

const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function allowedDatabaseHosts(value: string | undefined): Set<string> {
  if (typeof value !== "string" || value.trim() === "") return new Set();
  const hosts = value.split(",").map((host) => host.trim().toLowerCase());
  if (hosts.some((host) => !HOSTNAME_PATTERN.test(host))) return new Set();
  return new Set(hosts);
}

export function isAdminE2EDatabaseTargetAllowed(
  environment: Pick<VercelDeploymentIdentity, "VERCEL_ENV" | "VERCEL_GIT_COMMIT_REF" | "DATABASE_URL" | "ADMIN_VERIFY_PREVIEW_DATABASE_HOSTS">,
): boolean {
  if (
    environment.VERCEL_ENV !== "preview"
    || typeof environment.VERCEL_GIT_COMMIT_REF !== "string"
    || environment.VERCEL_GIT_COMMIT_REF.length === 0
    || environment.VERCEL_GIT_COMMIT_REF === "main"
    || typeof environment.DATABASE_URL !== "string"
  ) {
    return false;
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(environment.DATABASE_URL);
  } catch {
    return false;
  }

  if (databaseUrl.protocol !== "postgres:" && databaseUrl.protocol !== "postgresql:") {
    return false;
  }

  const hostname = databaseUrl.hostname.toLowerCase();
  return HOSTNAME_PATTERN.test(hostname)
    && allowedDatabaseHosts(environment.ADMIN_VERIFY_PREVIEW_DATABASE_HOSTS).has(hostname);
}

export function isAdminE2ECleanupEnabled(
  environment: VercelDeploymentIdentity = {
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
    VERCEL_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID,
    VERCEL_URL: process.env.VERCEL_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    ADMIN_VERIFY_PREVIEW_DATABASE_HOSTS: process.env.ADMIN_VERIFY_PREVIEW_DATABASE_HOSTS,
  },
): boolean {
  return environment.VERCEL_ENV === "preview"
    && typeof environment.VERCEL_GIT_COMMIT_REF === "string"
    && environment.VERCEL_GIT_COMMIT_REF.length > 0
    && environment.VERCEL_GIT_COMMIT_REF !== "main"
    && typeof environment.VERCEL_GIT_COMMIT_SHA === "string"
    && /^[a-f0-9]{40}$/i.test(environment.VERCEL_GIT_COMMIT_SHA)
    && typeof environment.VERCEL_DEPLOYMENT_ID === "string"
    && environment.VERCEL_DEPLOYMENT_ID.length > 0
    && typeof environment.VERCEL_URL === "string"
    && environment.VERCEL_URL.length > 0
    && isAdminE2EDatabaseTargetAllowed(environment);
}
