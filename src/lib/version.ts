export type PublicVersionInfo = {
  service: "esports-schedule";
  environment: string | null;
  gitCommitSha: string | null;
  gitCommitRef: string | null;
  deploymentId: string | null;
  deploymentUrl: string | null;
  buildTimestamp: string | null;
  runtimeTimestamp: string;
};

export type PublicVersionSummary = Pick<
  PublicVersionInfo,
  "gitCommitSha" | "deploymentId" | "buildTimestamp"
>;

type VersionEnvironment = {
  vercelTargetEnvironment?: string;
  vercelEnvironment?: string;
  vercelGitCommitSha?: string;
  vercelGitCommitRef?: string;
  vercelDeploymentId?: string;
  vercelUrl?: string;
  buildEnvironment?: string;
  buildGitCommitSha?: string;
  buildGitCommitRef?: string;
  buildDeploymentId?: string;
  buildDeploymentUrl?: string;
  buildTimestamp?: string;
};

function clean(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function deploymentUrl(value: string | null): string | null {
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function readVersionEnvironment(): VersionEnvironment {
  return {
    vercelTargetEnvironment: process.env.VERCEL_TARGET_ENV,
    vercelEnvironment: process.env.VERCEL_ENV,
    vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA,
    vercelGitCommitRef: process.env.VERCEL_GIT_COMMIT_REF,
    vercelDeploymentId: process.env.VERCEL_DEPLOYMENT_ID,
    vercelUrl: process.env.VERCEL_URL,
    buildEnvironment: process.env.ESPORTS_BUILD_ENVIRONMENT,
    buildGitCommitSha: process.env.ESPORTS_BUILD_GIT_COMMIT_SHA,
    buildGitCommitRef: process.env.ESPORTS_BUILD_GIT_COMMIT_REF,
    buildDeploymentId: process.env.ESPORTS_BUILD_DEPLOYMENT_ID,
    buildDeploymentUrl: process.env.ESPORTS_BUILD_DEPLOYMENT_URL,
    buildTimestamp: process.env.ESPORTS_BUILD_TIMESTAMP,
  };
}

export function getPublicVersionInfo(
  now = new Date(),
  environment = readVersionEnvironment(),
): PublicVersionInfo {
  const resolvedDeploymentUrl = clean(environment.vercelUrl)
    ?? clean(environment.buildDeploymentUrl);

  return {
    service: "esports-schedule",
    environment:
      clean(environment.vercelTargetEnvironment)
      ?? clean(environment.vercelEnvironment)
      ?? clean(environment.buildEnvironment),
    gitCommitSha:
      clean(environment.vercelGitCommitSha)
      ?? clean(environment.buildGitCommitSha),
    gitCommitRef:
      clean(environment.vercelGitCommitRef)
      ?? clean(environment.buildGitCommitRef),
    deploymentId:
      clean(environment.vercelDeploymentId)
      ?? clean(environment.buildDeploymentId),
    deploymentUrl: deploymentUrl(resolvedDeploymentUrl),
    buildTimestamp: clean(environment.buildTimestamp),
    runtimeTimestamp: now.toISOString(),
  };
}

export function getPublicVersionSummary(): PublicVersionSummary {
  const version = getPublicVersionInfo();
  return {
    gitCommitSha: version.gitCommitSha,
    deploymentId: version.deploymentId,
    buildTimestamp: version.buildTimestamp,
  };
}
