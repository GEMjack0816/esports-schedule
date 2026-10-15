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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
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
