import { describe, expect, it } from "vitest";
import { getUnsent, setUnsent } from "./unsent";

describe("unsent direction and hint (decision 59)", () => {
  it("starts empty", () => {
    expect(getUnsent("never-typed")).toEqual({ direction: "", hint: "" });
  });

  it("keeps the direction and the hint apart, per story", () => {
    setUnsent("story-a", { direction: "Climb the peak" });
    setUnsent("story-a", { hint: "shorter" });
    setUnsent("story-b", { direction: "Go home" });
    expect(getUnsent("story-a")).toEqual({ direction: "Climb the peak", hint: "shorter" });
    expect(getUnsent("story-b")).toEqual({ direction: "Go home", hint: "" });
  });

  it("forgets a story once both are cleared, as after a block is written", () => {
    setUnsent("story-c", { direction: "Fight", hint: "longer" });
    setUnsent("story-c", { direction: "", hint: "" });
    expect(getUnsent("story-c")).toEqual({ direction: "", hint: "" });
  });
});
