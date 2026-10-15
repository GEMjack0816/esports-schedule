import { createHash } from "node:crypto";

const [hostnameInput, databaseNameInput] = process.argv.slice(2);
const hostname = hostnameInput?.trim().toLowerCase();
const databaseName = databaseNameInput?.trim();

if (
  !hostname
  || !/^[a-z0-9.-]+$/i.test(hostname)
  || hostname.startsWith(".")
  || hostname.endsWith(".")
  || hostname.includes("..")
  || !databaseName
  || databaseName.includes("\0")
) {
  console.error("Usage: npm run fingerprint:preview-db-target -- <neon-hostname> <database-name>");
  process.exit(2);
}

const fingerprint = createHash("sha256")
  .update(`${hostname}\0${databaseName}`, "utf8")
  .digest("hex");
console.log(fingerprint);
