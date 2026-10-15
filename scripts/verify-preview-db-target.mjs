import { createHash } from "node:crypto";

const [actualFingerprint, hostname, databaseName] = process.argv.slice(2);

if (
  !/^[a-f0-9]{64}$/i.test(actualFingerprint ?? "")
  || !hostname?.trim()
  || !databaseName?.trim()
  || hostname.includes("@")
  || hostname.includes("/")
) {
  console.error("Usage: npm run verify:preview-db-target -- <fingerprint> <neon-hostname> <database-name>");
  process.exit(2);
}

const expectedFingerprint = createHash("sha256")
  .update(`${hostname.toLowerCase()}\0${databaseName}`, "utf8")
  .digest("hex");

if (actualFingerprint.toLowerCase() !== expectedFingerprint) {
  console.error("FAIL: Preview database target does not match the expected Neon endpoint/database.");
  process.exit(1);
}

console.log("PASS: Preview database target matches the expected Neon endpoint/database.");
