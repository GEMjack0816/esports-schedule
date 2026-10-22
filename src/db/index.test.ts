import { describe, expect, it } from "vitest";
import { createPostgresClientOptions, safeDatabaseErrorCode } from "./index";

describe("PostgreSQL client options", () => {
  it("does not send unsupported timeout startup parameters to Neon poolers", () => {
    const options = createPostgresClientOptions();
    expect(options).not.toHaveProperty("connection");
  });
});

describe("safeDatabaseErrorCode", () => {
  it.each([
    ["statement timeout", "57014"],
    ["idle transaction timeout", "25P03"],
  ])("classifies %s without exposing driver details", (_label, code) => {
    expect(safeDatabaseErrorCode({ code })).toBe("TIMEOUT");
  });

  it("keeps lock timeouts distinct", () => {
    expect(safeDatabaseErrorCode({ code: "55P03" })).toBe("LOCK_TIMEOUT");
  });

  it("does not expose unknown database error codes", () => {
    expect(safeDatabaseErrorCode({ code: "XX999", message: "private driver detail" })).toBe("UNAVAILABLE");
  });
});
