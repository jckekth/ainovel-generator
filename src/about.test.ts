import { describe, expect, it } from "vitest";
import { ABOUT, placeholdersLeft } from "./about.config";

// The installer check of decision 94 (scripts/check-about.mjs) uses placeholdersLeft.
describe("About placeholders (spec 10, decision 94, CR-07)", () => {
  it("finds none in the shipped config", () => {
    expect(placeholdersLeft()).toEqual([]);
  });

  it("finds a placeholder left in any text value", () => {
    expect(placeholdersLeft({ ...ABOUT, homePage: "https://example.itch.io/ai-novel-generator" })).toEqual(["example.itch.io"]);
    expect(placeholdersLeft({ ...ABOUT, homePage: "https://x.itch.io", email: "TODO" })).toEqual(["TODO"]);
  });
});
