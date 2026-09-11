import "server-only";

import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import type { PandaGameSnapshot } from "./pandascore";

// Vercel Runtime Cache allows 2 MB/item. Leave room for serialization metadata
// and measure UTF-8 bytes, not JS string length (team names may be multibyte).
export const MAX_RUNTIME_SNAPSHOT_BYTES = 1_800_000;
// This only limits the optional cache encoding/decoding work, NOT persisted
// snapshots or the number of matches returned from PostgreSQL.
export const MAX_DECODED_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const FORMAT = "pandascore-json-gzip-v1";
const compress = promisify(gzip);
const decompress = promisify(gunzip);

type CompressedSnapshot = {
  format: typeof FORMAT;
  decodedBytes: number;
  data: string;
};

export async function encodeRuntimeSnapshot(
  snapshot: PandaGameSnapshot,
): Promise<PandaGameSnapshot | CompressedSnapshot | null> {
  const json = JSON.stringify(snapshot);
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes <= MAX_RUNTIME_SNAPSHOT_BYTES) return snapshot;
  if (bytes > MAX_DECODED_SNAPSHOT_BYTES) return null;

  const compressed = await compress(json, { level: 1 });
  const envelope: CompressedSnapshot = {
    format: FORMAT,
    decodedBytes: bytes,
    data: compressed.toString("base64"),
  };
  return Buffer.byteLength(JSON.stringify(envelope), "utf8") <= MAX_RUNTIME_SNAPSHOT_BYTES
    ? envelope
    : null;
}

export async function decodeRuntimeSnapshot(value: unknown): Promise<unknown | null> {
  if (!value || typeof value !== "object") return value;
  // Continue accepting previously cached plain snapshots during rollout.
  if (!("format" in value)) return value;
  const envelope = value as Partial<CompressedSnapshot>;
  if (envelope.format !== FORMAT
    || typeof envelope.data !== "string"
    || envelope.data.length === 0
    || envelope.data.length > MAX_RUNTIME_SNAPSHOT_BYTES
    || !Number.isSafeInteger(envelope.decodedBytes)
    || (envelope.decodedBytes ?? 0) <= 0
    || (envelope.decodedBytes ?? Infinity) > MAX_DECODED_SNAPSHOT_BYTES) return null;

  try {
    const compressed = Buffer.from(envelope.data, "base64");
    // Buffer.from is lenient; reject malformed/noncanonical encodings explicitly.
    if (compressed.toString("base64") !== envelope.data) return null;
    const decoded = await decompress(compressed, { maxOutputLength: envelope.decodedBytes });
    if (decoded.byteLength !== envelope.decodedBytes) return null;
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
  } catch {
    // The caller falls back to the durable snapshot. Never log the payload or
    // decompression/parser errors, which could include embedded source content.
    return null;
  }
}
