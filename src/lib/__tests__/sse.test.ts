import { describe, it, expect } from "vitest";
import { generateId, extractAppId, isAppStoreUrl } from "../sse";

describe("generateId", () => {
  it("formats with zero-padded index", () => {
    expect(generateId("F", 0)).toBe("F-001");
    expect(generateId("F", 9)).toBe("F-010");
    expect(generateId("REQ", 99)).toBe("REQ-100");
  });

  it("pads to 3 digits", () => {
    expect(generateId("TC", 0)).toHaveLength(6); // "TC-001"
    expect(generateId("TC", 0)).toBe("TC-001");
  });
});

describe("extractAppId", () => {
  it("extracts numeric id from standard App Store URL", () => {
    expect(
      extractAppId("https://apps.apple.com/us/app/workout-for-women/id839285684")
    ).toBe("839285684");
  });

  it("extracts from itunes URL", () => {
    expect(
      extractAppId("https://itunes.apple.com/app/id1234567890")
    ).toBe("1234567890");
  });

  it("returns null when no id present", () => {
    expect(extractAppId("https://apps.apple.com/us/app/some-app")).toBeNull();
    expect(extractAppId("not a url")).toBeNull();
    expect(extractAppId("")).toBeNull();
  });
});

describe("isAppStoreUrl", () => {
  it("recognises apps.apple.com", () => {
    expect(isAppStoreUrl("https://apps.apple.com/us/app/id123")).toBe(true);
  });

  it("recognises itunes.apple.com", () => {
    expect(isAppStoreUrl("https://itunes.apple.com/app/id123")).toBe(true);
  });

  it("rejects non-App Store URLs", () => {
    expect(isAppStoreUrl("https://play.google.com/store/apps/details?id=com.x")).toBe(false);
    expect(isAppStoreUrl("https://example.com")).toBe(false);
    expect(isAppStoreUrl("")).toBe(false);
  });
});
