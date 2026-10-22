import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testPandaSnapshot } from "@/test/pandascore-snapshot";
import {
  decodeRuntimeSnapshot, encodeRuntimeSnapshot, estimateSnapshotJsonBytes,
  MAX_DECODED_SNAPSHOT_BYTES, MAX_RUNTIME_SNAPSHOT_BYTES,
  MAX_SNAPSHOT_DEPTH, MAX_SNAPSHOT_NODES,
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

  it("estimates JSON UTF-8 bytes exactly for escaping and Unicode", () => {
    const value = {
      quote: 'a"b\\c\u0000\b\t\n\f\r\u001f',
      cjk: "赛事",
      emoji: "🏆",
      loneSurrogate: "\ud800",
      numbers: [-0, 1e21, Number.NaN],
      array: [null, true, undefined],
      omitted: undefined,
    };
    const expected = Buffer.byteLength(JSON.stringify(value), "utf8");
    expect(estimateSnapshotJsonBytes(value, expected)).toBe(expected);
    expect(estimateSnapshotJsonBytes(value, expected - 1)).toBeNull();
  });

  it("declines an excessive snapshot before serializing the full object", async () => {
    const original = testPandaSnapshot();
    original.matches[0].league = "x".repeat(MAX_DECODED_SNAPSHOT_BYTES);
    const stringifySpy = vi.spyOn(JSON, "stringify");
    try {
      await expect(encodeRuntimeSnapshot(original)).resolves.toBeNull();
      expect(stringifySpy).not.toHaveBeenCalled();
    } finally {
      stringifySpy.mockRestore();
    }
  });

  it("fails closed for cycles, custom serialization hooks and accessors", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(estimateSnapshotJsonBytes(cycle)).toBeNull();
    expect(estimateSnapshotJsonBytes({ toJSON: () => ({}) })).toBeNull();
    const accessor = Object.defineProperty({}, "value", { enumerable: true, get: () => "unsafe" });
    expect(estimateSnapshotJsonBytes(accessor)).toBeNull();
  });

  it.each([
    ["Object.prototype", Object.prototype],
    ["Array.prototype", Array.prototype],
  ])("fails closed when %s supplies an inherited toJSON hook", async (_name, prototype) => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(prototype, "toJSON");
    let hookCalled = false;
    Object.defineProperty(prototype, "toJSON", {
      configurable: true,
      value: () => { hookCalled = true; return null; },
    });

    let encoded: unknown;
    try {
      encoded = await encodeRuntimeSnapshot(testPandaSnapshot());
    } finally {
      if (originalDescriptor) Object.defineProperty(prototype, "toJSON", originalDescriptor);
      else Reflect.deleteProperty(prototype, "toJSON");
    }

    expect(encoded).toBeNull();
    expect(hookCalled).toBe(false);
  });

  it("accepts the maximum supported depth and rejects one level beyond it", () => {
    const nested = (levels: number) => {
      let value: unknown = "leaf";
      for (let level = 0; level < levels; level += 1) value = { value };
      return value;
    };

    expect(estimateSnapshotJsonBytes(nested(MAX_SNAPSHOT_DEPTH))).not.toBeNull();
    expect(estimateSnapshotJsonBytes(nested(MAX_SNAPSHOT_DEPTH + 1))).toBeNull();
  });

  it("bounds traversal at the exact node budget", () => {
    const atLimit = new Array(MAX_SNAPSHOT_NODES - 1).fill(null);
    const overLimit = new Array(MAX_SNAPSHOT_NODES).fill(null);

    expect(estimateSnapshotJsonBytes(atLimit)).not.toBeNull();
    expect(estimateSnapshotJsonBytes(overLimit)).toBeNull();
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

