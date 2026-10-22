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
export const MAX_SNAPSHOT_NODES = 250_000;
export const MAX_SNAPSHOT_DEPTH = 100;

/**
 * Count the UTF-8 bytes JSON.stringify would emit without allocating the full
 * string. The traversal is budgeted and only accepts normalized JSON data;
 * accessors, custom objects, cycles, and toJSON hooks fail closed so cache
 * encoding can be skipped while the full PostgreSQL snapshot is retained.
 */
export function estimateSnapshotJsonBytes(
  value: unknown,
  maxBytes: number = MAX_DECODED_SNAPSHOT_BYTES,
): number | null {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) return null;
  // JSON.stringify also invokes inherited toJSON hooks. If either built-in
  // prototype has been extended, the preflight could otherwise measure a
  // different value from the one actually serialized.
  if (Object.prototype.hasOwnProperty.call(Object.prototype, "toJSON")
    || Object.prototype.hasOwnProperty.call(Array.prototype, "toJSON")) return null;

  let bytes = 0;
  let nodes = 0;
  const ancestors = new Set<object>();
  const add = (count: number): boolean => {
    bytes += count;
    return bytes <= maxBytes;
  };
  const addString = (text: string): boolean => {
    if (!add(2)) return false; // opening and closing quotes
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code === 0x22 || code === 0x5c
        || code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) {
        if (!add(2)) return false;
      } else if (code < 0x20) {
        if (!add(6)) return false;
      } else if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          if (!add(4)) return false;
          index += 1;
        } else if (!add(6)) return false; // JSON.stringify escapes lone surrogates
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        if (!add(6)) return false;
      } else if (code < 0x80) {
        if (!add(1)) return false;
      } else if (code < 0x800) {
        if (!add(2)) return false;
      } else if (!add(3)) return false;
    }
    return true;
  };
  const visit = (current: unknown, depth: number): boolean => {
    nodes += 1;
    if (nodes > MAX_SNAPSHOT_NODES || depth > MAX_SNAPSHOT_DEPTH) return false;
    if (current === null) return add(4);
    if (typeof current === "string") return addString(current);
    if (typeof current === "boolean") return add(current ? 4 : 5);
    if (typeof current === "number") return add(Number.isFinite(current) ? String(current).length : 4);
    if (typeof current !== "object") return false;
    if (ancestors.has(current)) return false;

    ancestors.add(current);
    let valid = true;
    if (Array.isArray(current)) {
      if (Object.getPrototypeOf(current) !== Array.prototype
        || Object.prototype.hasOwnProperty.call(current, "toJSON")) valid = false;
      if (valid) valid = add(1); // [
      for (let index = 0; valid && index < current.length; index += 1) {
        if (index > 0) valid = add(1); // comma
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (descriptor && !("value" in descriptor)) valid = false;
        const item = descriptor ? descriptor.value : null;
        if (valid) {
          valid = item === undefined || typeof item === "function" || typeof item === "symbol"
            ? add(4) // JSON.stringify emits null for unsupported array entries
            : visit(item, depth + 1);
        }
      }
      if (valid) valid = add(1); // ]
    } else {
      const prototype = Object.getPrototypeOf(current);
      if ((prototype !== Object.prototype && prototype !== null)
        || Object.prototype.hasOwnProperty.call(current, "toJSON")) valid = false;
      if (valid) valid = add(1); // {
      let first = true;
      if (valid) {
        // for...in avoids allocating a full keys/descriptors array. Snapshot
        // objects are normalized plain records; inherited keys are ignored.
        for (const key in current) {
          if (!Object.prototype.hasOwnProperty.call(current, key)) continue;
          const descriptor = Object.getOwnPropertyDescriptor(current, key);
          if (!descriptor || !("value" in descriptor)) { valid = false; break; }
          const propertyValue = descriptor.value;
          if (propertyValue === undefined || typeof propertyValue === "function" || typeof propertyValue === "symbol") continue;
          if (!first) valid = add(1); // comma
          if (valid) valid = addString(key);
          if (valid) valid = add(1); // colon
          if (valid) valid = visit(propertyValue, depth + 1);
          first = false;
          if (!valid) break;
        }
      }
      if (valid) valid = add(1); // }
    }
    ancestors.delete(current);
    return valid;
  };

  return visit(value, 0) ? bytes : null;
}

type CompressedSnapshot = {
  format: typeof FORMAT;
  decodedBytes: number;
  data: string;
};

export async function encodeRuntimeSnapshot(
  snapshot: PandaGameSnapshot,
): Promise<PandaGameSnapshot | CompressedSnapshot | null> {
  // Bound traversal before JSON.stringify allocates an entire serialized copy.
  // PostgreSQL keeps the complete snapshot if this optional cache encoding is
  // too large or contains an unsupported shape.
  if (estimateSnapshotJsonBytes(snapshot) === null) return null;

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

