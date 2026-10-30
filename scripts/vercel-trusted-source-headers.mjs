import { execFileSync } from "node:child_process";

export const VERCEL_TRUSTED_SOURCE_HEADER = "x-vercel-trusted-oidc-idp-token";
export const MAX_TRUSTED_SOURCE_REDIRECTS = 10;
export const ESPORTS_SCHEDULE_VERCEL_PROJECT_ID = "prj_o5ujB2omd6c1Mish4voL9wFCFdRB";
export const ESPORTS_SCHEDULE_VERCEL_TEAM_ID = "team_Cz8cQhDVK9X0SRfXPToHArmi";

export function redactTrustedSourceToken(value, token) {
  const text = String(value ?? "");
  return token ? text.split(token).join("[redacted]") : text;
}

const BROWSER_ENV_ALLOWLIST = new Set([
  "APPDATA",
  "COMSPEC",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "NO_COLOR",
  "OS",
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "WINDIR",
]);
const VERCEL_CLI_ENV_ALLOWLIST = new Set([...BROWSER_ENV_ALLOWLIST, "VERCEL_TOKEN"]);

export function isolateBrowserEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => BROWSER_ENV_ALLOWLIST.has(name.toUpperCase())),
  );
}

export function isolateVercelCliEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => VERCEL_CLI_ENV_ALLOWLIST.has(name.toUpperCase())),
  );
}

/**
 * A short-lived Vercel identity must never be sent to an arbitrary URL passed
 * on the command line. Protected verification is limited to this project's
 * HTTPS Vercel deployment hostnames; callers still scope the header to this
 * exact origin below.
 */
export function getTrustedVercelDeploymentOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.port
    || !/^esports-schedule-[a-z0-9-]+-jack-zhu-s-projects\.vercel\.app$/.test(url.hostname)
  ) {
    return null;
  }

  return url.origin;
}

function runVercelJson(args) {
  const env = isolateVercelCliEnvironment(process.env);
  delete env.DEBUG;
  delete env.PWDEBUG;

  try {
    // The URL is already restricted by getTrustedVercelDeploymentOrigin; all
    // remaining command arguments are constants. On Windows Vercel is
    // installed as a .cmd shim, so invoke it through cmd.exe.
    const command = process.platform === "win32"
      ? ["cmd.exe", ["/d", "/s", "/c", `vercel ${args.join(" ")}`]]
      : ["vercel", args];
    const output = execFileSync(command[0], command[1], {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 20_000,
      maxBuffer: 1_000_000,
      windowsHide: true,
    });
    return JSON.parse(output);
  } catch {
    // CLI output can include request diagnostics; never surface it while an
    // OIDC credential is present in the parent process.
    throw new Error("Unable to verify the Vercel Preview deployment identity; no identity header was sent.");
  }
}

/**
 * A hostname pattern alone is not a project identity: another project in the
 * same Vercel team can have a similarly named deployment URL. Before sending
 * the short-lived OIDC token, check both the deployment API's projectId and
 * Vercel CLI's deployment target using the caller's existing CLI login.
 */
export function verifyTrustedVercelPreviewDeployment(value, runJson = runVercelJson) {
  const origin = getTrustedVercelDeploymentOrigin(value);
  if (!origin) {
    throw new Error("VERCEL_OIDC_TOKEN only supports this project's HTTPS Vercel Preview deployment URL.");
  }

  const hostname = new URL(value).hostname;
  const scope = ["--scope", ESPORTS_SCHEDULE_VERCEL_TEAM_ID, "--non-interactive"];
  const deployment = runJson([
    "api",
    `/v13/deployments/${hostname}`,
    ...scope,
    "--raw",
  ]);
  const inspection = runJson([
    "inspect",
    hostname,
    "--format=json",
    ...scope,
  ]);

  if (
    deployment?.projectId !== ESPORTS_SCHEDULE_VERCEL_PROJECT_ID
    || inspection?.name !== "esports-schedule"
    || inspection?.target !== "preview"
    || inspection?.readyState !== "READY"
  ) {
    throw new Error("VERCEL_OIDC_TOKEN was not sent because the target is not this project's READY Preview deployment.");
  }

  return origin;
}

/**
 * Add the short-lived Vercel development identity only to requests for the
 * exact deployment origin under test. Never forward it to third-party assets.
 */
export function addTrustedSourceHeader(headers, requestUrl, targetOrigin, token) {
  const safeHeaders = { ...headers };
  for (const name of Object.keys(safeHeaders)) {
    if (name.toLowerCase() === VERCEL_TRUSTED_SOURCE_HEADER) delete safeHeaders[name];
  }

  if (!token || new URL(requestUrl).origin !== targetOrigin) return safeHeaders;

  return {
    ...safeHeaders,
    [VERCEL_TRUSTED_SOURCE_HEADER]: token,
  };
}

/**
 * Playwright's route.continue({ headers }) applies those headers to every
 * redirect hop. Fetch one hop at a time so the short-lived identity is only
 * sent to this exact Preview origin. External redirects are returned to the
 * browser as ordinary 3xx responses, without the identity header.
 */
export async function fetchTrustedSourceResponse(route, targetOrigin, token) {
  const request = route.request();
  const requestUrl = request.url();
  const trustedOrigin = token && new URL(requestUrl).origin === targetOrigin
    ? targetOrigin
    : null;
  let currentUrl = requestUrl;
  let response = await route.fetch({
    headers: addTrustedSourceHeader(request.headers(), currentUrl, trustedOrigin, token),
    maxRedirects: 0,
  });

  if (!trustedOrigin || !["GET", "HEAD"].includes(request.method().toUpperCase())) return response;

  for (let redirects = 0; redirects < MAX_TRUSTED_SOURCE_REDIRECTS; redirects += 1) {
    if (![301, 302, 303, 307, 308].includes(response.status())) return response;

    const location = response.headers().location;
    if (!location) return response;

    const nextUrl = new URL(location, currentUrl);
    if (nextUrl.origin !== trustedOrigin) return response;

    currentUrl = nextUrl.toString();
    response = await route.fetch({
      url: currentUrl,
      headers: addTrustedSourceHeader(request.headers(), currentUrl, trustedOrigin, token),
      maxRedirects: 0,
    });
  }

  return response;
}
