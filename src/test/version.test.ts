import { describe, expect, it } from "vitest";
import { isNewerVersion, parseVersion } from "@/lib/version";

describe("isNewerVersion", () => {
  it("detects a newer patch / minor / major", () => {
    expect(isNewerVersion("v1.0.2", "1.0.1")).toBe(true);
    expect(isNewerVersion("1.1.0", "1.0.99")).toBe(true);
    expect(isNewerVersion("2.0.0", "1.9.9")).toBe(true);
  });
  it("is false for equal or older versions", () => {
    expect(isNewerVersion("1.0.1", "1.0.1")).toBe(false);
    expect(isNewerVersion("v1.0.1", "1.0.2")).toBe(false);
    expect(isNewerVersion("1.0", "1.0.0")).toBe(false);
  });
  it("compares numerically, not as strings", () => {
    expect(isNewerVersion("1.0.10", "1.0.9")).toBe(true);
  });
  it("parses tags with a v prefix", () => {
    expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
  });
});
