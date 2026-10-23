type VercelDeploymentIdentity = {
  VERCEL_ENV?: string;
  VERCEL_GIT_COMMIT_REF?: string;
  VERCEL_GIT_COMMIT_SHA?: string;
  VERCEL_DEPLOYMENT_ID?: string;
  VERCEL_URL?: string;
};

export function isAdminE2ECleanupEnabled(
  environment: VercelDeploymentIdentity = {
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
    VERCEL_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID,
    VERCEL_URL: process.env.VERCEL_URL,
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
    && environment.VERCEL_URL.length > 0;
}
