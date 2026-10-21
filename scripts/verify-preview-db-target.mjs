import { createHash } from "node:crypto";

const [actualFingerprint, hostname, databaseName, suppliedPort] = process.argv.slice(2);
const port = suppliedPort ?? "5432";

function normalizeDatabaseHostname(value) {
  const normalized = value.toLowerCase();
  if (!normalized.endsWith(".neon.tech")) return normalized;

  const firstDot = normalized.indexOf(".");
  const endpointLabel = firstDot === -1 ? normalized : normalized.slice(0, firstDot);
  if (!endpointLabel.startsWith("ep-") || !endpointLabel.endsWith("-pooler")) {
    return normalized;
  }

  return `${endpointLabel.slice(0, -"-pooler".length)}${normalized.slice(firstDot)}`;
}

if (
  !/^[a-f0-9]{64}$/i.test(actualFingerprint ?? "")
  || !hostname?.trim()
  || !databaseName?.trim()
  || hostname.includes("@")
  || hostname.includes("/")
  || !/^\d{1,5}$/.test(port)
  || Number(port) < 1
  || Number(port) > 65535
) {
  console.error("Usage: npm run verify:preview-db-target -- <fingerprint> <neon-hostname> <database-name> [port]");
  process.exit(2);
}

const expectedFingerprint = createHash("sha256")
  .update(`${normalizeDatabaseHostname(hostname)}:${Number(port)}\0${databaseName}`, "utf8")
  .digest("hex");

if (actualFingerprint.toLowerCase() !== expectedFingerprint) {
  console.error("FAIL: Preview database target does not match the expected Neon endpoint/database.");
  process.exit(1);
}

console.log("PASS: Preview database target matches the expected Neon endpoint/database.");

