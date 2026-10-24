import { describe, expect, it } from "vitest";
import { containsCarriageReturn } from "./migration-line-endings-core.mjs";

describe("migration line-ending bytes", () => {
  it("accepts LF-only migration contents", () => {
    expect(containsCarriageReturn(Buffer.from("CREATE TABLE x;\n"))).toBe(false);
  });

  it("rejects CRLF migration contents", () => {
    expect(containsCarriageReturn(Buffer.from("CREATE TABLE x;\r\n"))).toBe(true);
  });

  it("rejects a bare carriage return that CRLF-only checks miss", () => {
    expect(containsCarriageReturn(Buffer.from("CREATE TABLE x;\rCREATE TABLE y;\n"))).toBe(true);
  });

  it("accepts empty contents", () => {
    expect(containsCarriageReturn(Buffer.alloc(0))).toBe(false);
  });
});
