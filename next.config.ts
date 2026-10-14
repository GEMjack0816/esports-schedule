import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";

function gitMetadata(...args: string[]): string {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

const buildTimestamp = new Date().toISOString();
const buildGitCommitSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim()
  || gitMetadata("rev-parse", "HEAD");
const buildGitCommitRef = process.env.VERCEL_GIT_COMMIT_REF?.trim()
  || gitMetadata("branch", "--show-current");

const nextConfig: NextConfig = {
  images: {
    // PandaScore team logos are stable by URL; keep their optimized copies warm
    // for 24 hours to ride through short CDN outages without caching forever.
    minimumCacheTTL: 86_400,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.pandascore.co",
        port: "",
        pathname: "/images/team/image/**",
        search: "",
      },
    ],
  },
  env: {
    ESPORTS_BUILD_TIMESTAMP: buildTimestamp,
    ESPORTS_BUILD_GIT_COMMIT_SHA: buildGitCommitSha,
    ESPORTS_BUILD_GIT_COMMIT_REF: buildGitCommitRef,
    ESPORTS_BUILD_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID?.trim() ?? "",
    ESPORTS_BUILD_DEPLOYMENT_URL: process.env.VERCEL_URL?.trim() ?? "",
    ESPORTS_BUILD_ENVIRONMENT:
      process.env.VERCEL_TARGET_ENV?.trim()
      || process.env.VERCEL_ENV?.trim()
      || process.env.NODE_ENV
      || "",
  },
};

export default nextConfig;
