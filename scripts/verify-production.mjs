const baseUrlInput = process.argv[2];
const expectedSha = process.argv[3] || process.env.EXPECTED_GIT_COMMIT_SHA;

if (!baseUrlInput) {
  console.error("FAIL base URL: pass the deployment URL as the first argument.");
  process.exit(1);
}
if (!expectedSha) {
  console.error("FAIL expected SHA: pass it as the second argument or EXPECTED_GIT_COMMIT_SHA.");
  process.exit(1);
}

let baseUrl;
try {
  baseUrl = new URL(baseUrlInput);
  if (!["http:", "https:"].includes(baseUrl.protocol)) throw new Error("unsupported protocol");
} catch {
  console.error("FAIL base URL: expected an absolute HTTP(S) URL.");
  process.exit(1);
}

const failures = [];
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`PASS ${label}${detail ? ` — ${detail}` : ""}`);
    return;
  }
  console.error(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  failures.push(label);
}

async function request(pathname, type) {
  const url = new URL(pathname, baseUrl);
  url.searchParams.set("production-verify", Date.now().toString());
  let response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: type === "json" ? "application/json" : "text/html" },
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new Error(`${pathname} request failed.`);
  }

  let body;
  try {
    body = type === "json" ? await response.json() : await response.text();
  } catch {
    throw new Error(`${pathname} returned an unreadable ${type} response`);
  }
  return { response, body };
}

function pageCommit(html) {
  const tag = html.match(/<span\b[^>]*\bid=["']esports-schedule-version["'][^>]*>/i)?.[0];
  return tag?.match(/\bdata-git-commit=["']([^"']*)["']/i)?.[1] || null;
}

function cacheControlHas(value, directive) {
  return value
    ?.split(",")
    .map((item) => item.trim().toLowerCase())
    .includes(directive) ?? false;
}

try {
  const [home, versionResult, healthResult] = await Promise.all([
    request("/", "text"),
    request("/api/version", "json"),
    request("/api/health/data-coverage", "json"),
  ]);
  const version = versionResult.body;
  const health = healthResult.body;
  const homeHtml = home.body;
  const versionCacheControl = versionResult.response.headers.get("cache-control");
  const healthCacheControl = healthResult.response.headers.get("cache-control");
  const allowedVersionKeys = [
    "buildTimestamp",
    "deploymentId",
    "deploymentUrl",
    "environment",
    "gitCommitRef",
    "gitCommitSha",
    "runtimeTimestamp",
    "service",
  ];
  const sensitiveNames = ["PANDASCORE_TOKEN", "CRON_SECRET", "Authorization", "Cookie"];
  const versionSerialized = JSON.stringify(version);
  const healthSerialized = JSON.stringify(health);

  check("homepage HTTP 200", home.response.status === 200, `HTTP ${home.response.status}`);
  check("/api/version HTTP 200", versionResult.response.status === 200, `HTTP ${versionResult.response.status}`);
  check("/api/health/data-coverage HTTP 200", healthResult.response.status === 200, `HTTP ${healthResult.response.status}`);
  check("/api/version service", version.service === "esports-schedule");
  check("/api/version expected Git commit", version.gitCommitSha === expectedSha);
  check("health/version Git commit consistency", health.version?.gitCommitSha === version.gitCommitSha);
  check("homepage/version Git commit consistency", pageCommit(homeHtml) === version.gitCommitSha);
  check("health mode=live", health.mode === "live");
  check("health demoMode=false", health.demoMode === false);
  check("health stale=false", health.stale === false);
  check("health refreshInProgress=false", health.refreshInProgress === false);
  check(
    "/api/version Cache-Control",
    cacheControlHas(versionCacheControl, "no-store")
      && cacheControlHas(versionCacheControl, "no-cache")
      && cacheControlHas(versionCacheControl, "must-revalidate"),
  );
  check("health Cache-Control no-store", cacheControlHas(healthCacheControl, "no-store"));
  check(
    "/api/version public field allowlist",
    Object.keys(version).sort().join(",") === allowedVersionKeys.join(","),
  );
  check(
    "responses contain no sensitive field names",
    sensitiveNames.every((name) => !versionSerialized.includes(name) && !healthSerialized.includes(name)),
  );

  for (const phrase of ["演示数据模式", "PandaScore Token 尚未配置", "当前展示演示赛程"]) {
    check(`homepage excludes “${phrase}”`, !homeHtml.includes(phrase));
  }
  for (const phrase of ["源快照时间", "提交遗漏比赛", "PandaScore 聚合数据"]) {
    check(`homepage includes “${phrase}”`, homeHtml.includes(phrase));
  }
} catch {
  console.error("FAIL verification request — details redacted.");
  failures.push("verification request");
}

if (failures.length > 0) {
  console.error(`Production verification failed (${failures.length} check${failures.length === 1 ? "" : "s"}).`);
  process.exit(1);
}

console.log("Production verification passed.");
