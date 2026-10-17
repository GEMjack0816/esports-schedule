import { createHash } from "node:crypto";

const [hostnameInput, databaseNameInput, portInput] = process.argv.slice(2);
const hostname = hostnameInput?.trim().toLowerCase();
const databaseName = databaseNameInput?.trim();
const port = portInput?.trim() || "5432";
const numericPort = Number(port);

if (
  !hostname
  || !/^[a-z0-9.-]+$/i.test(hostname)
  || hostname.startsWith(".")
  || hostname.endsWith(".")
  || hostname.includes("..")
  || !databaseName
  || databaseName.includes("\0")
  || !/^\\d+$/.test(port)
  || !Number.isInteger(numericPort)
  || numericPort < 1
  || numericPort > 65_535
) {
  console.error("Usage: node scripts/fingerprint-preview-db-target.mjs <database-hostname> <database-name> [port]");
  process.exit(2);
}

const fingerprint = createHash("sha256")
  .update(`${hostname}\0${numericPort}\0${databaseName}`, "utf8")
  .digest("hex");
console.log(fingerprint);
