import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testPandaSnapshot } from "@/test/pandascore-snapshot";
import {
  decodeRuntimeSnapshot, encodeRuntimeSnapshot,
  MAX_DECODED_SNAPSHOT_BYTES, MAX_RUNTIME_SNAPSHOT_BYTES,
} from "./cache-payload";

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("@vercel/functions", () => ({ getCache: () => mocks }));
import { readPandaScoreGameSnapshot, writePandaScoreGameSnapshot } from "./cache";

describe("bounded Runtime Cache snapshot codec", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.set.mockResolvedValue(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("retains compatibility with small plain snapshots", async () => {
    const original = testPandaSnapshot();
    expect(await encodeRuntimeSnapshot(original)).toBe(original);
    expect(await decodeRuntimeSnapshot(original)).toBe(original);
  });

  it("round-trips all matches, metadata and generation above the raw cache limit", async () => {
    const original = testPandaSnapshot(6_000);
    expect(Buffer.byteLength(JSON.stringify(original))).toBeGreaterThan(MAX_RUNTIME_SNAPSHOT_BYTES);
    const encoded = await encodeRuntimeSnapshot(original);
    expect(encoded).toHaveProperty("format", "pandascore-json-gzip-v1");
    expect(Buffer.byteLength(JSON.stringify(encoded))).toBeLessThan(MAX_RUNTIME_SNAPSHOT_BYTES);
    expect(await decodeRuntimeSnapshot(encoded)).toEqual(original);
    let stored: unknown = null;
    mocks.set.mockImplementation(async (_key, payload: unknown) => {
      // Model the documented silent refusal of an oversized cache item.
      if (Buffer.byteLength(JSON.stringify(payload)) <= 2_000_000) stored = payload;
    });
    await expect(writePandaScoreGameSnapshot(original)).resolves.toBe(true);
    mocks.get.mockImplementation(async () => stored);
    expect(await readPandaScoreGameSnapshot("lol")).toEqual(original);
  });

  it("measures multibyte team and tournament text in UTF-8 bytes", async () => {
    const original = testPandaSnapshot();
    original.matches[0].league = "汉".repeat(600_000);
    expect(JSON.stringify(original).length).toBeLessThan(MAX_RUNTIME_SNAPSHOT_BYTES);
    const encoded = await encodeRuntimeSnapshot(original);
    expect(encoded).toHaveProperty("format", "pandascore-json-gzip-v1");
    expect(await decodeRuntimeSnapshot(encoded)).toEqual(original);
  });

  it("declines incompressible payloads without writing an oversized item", async () => {
    const original = testPandaSnapshot();
    // Synthetic random bytes, not a credential or any external source data.
    original.matches[0].league = randomBytes(MAX_RUNTIME_SNAPSHOT_BYTES).toString("base64");
    await expect(writePandaScoreGameSnapshot(original)).resolves.toBe(false);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("declines excessive decoded size without truncating or mutating the source snapshot", async () => {
    const original = testPandaSnapshot();
    original.matches[0].league = "x".repeat(MAX_DECODED_SNAPSHOT_BYTES);
    await expect(writePandaScoreGameSnapshot(original)).resolves.toBe(false);
    expect(mocks.set).not.toHaveBeenCalled();
    expect(original.matches[0].league.length).toBe(MAX_DECODED_SNAPSHOT_BYTES);
    expect(original.syncGeneration).toBe(7);
  });

  it.each([
    { format: "unsupported", decodedBytes: 2, data: "e30=" },
    { format: "pandascore-json-gzip-v1", decodedBytes: 2, data: "not-base64" },
    { format: "pandascore-json-gzip-v1", decodedBytes: -1, data: "e30=" },
    { format: "pandascore-json-gzip-v1", decodedBytes: MAX_DECODED_SNAPSHOT_BYTES + 1, data: "e30=" },
    { format: "pandascore-json-gzip-v1", decodedBytes: 2, data: "e30=" },
  ])("rejects malformed envelopes without throwing or exposing contents", async (value) => {
    expect(await decodeRuntimeSnapshot(value)).toBeNull();
  });

  it("enforces the actual decompressed byte limit rather than trusting the size declaration", async () => {
    const data = gzipSync("x".repeat(1_000_000)).toString("base64");
    expect(await decodeRuntimeSnapshot({ format: "pandascore-json-gzip-v1", decodedBytes: 10, data })).toBeNull();
  });

  it("rejects oversized encoded data and wrong decoded size", async () => {
    expect(await decodeRuntimeSnapshot({ format: "pandascore-json-gzip-v1", decodedBytes: 10,
      data: "A".repeat(MAX_RUNTIME_SNAPSHOT_BYTES + 1) })).toBeNull();
    const data = gzipSync("{}").toString("base64");
    expect(await decodeRuntimeSnapshot({ format: "pandascore-json-gzip-v1", decodedBytes: 3, data })).toBeNull();
  });

  it("still validates the game and schema after successful decompression", async () => {
    const original = testPandaSnapshot(6_000);
    mocks.get.mockResolvedValue(await encodeRuntimeSnapshot(original));
    expect(await readPandaScoreGameSnapshot("dota2")).toBeNull();
    mocks.get.mockResolvedValue({ format: "pandascore-json-gzip-v1", decodedBytes: 2,
      data: gzipSync("{}").toString("base64") });
    expect(await readPandaScoreGameSnapshot("lol")).toBeNull();
  });
});
