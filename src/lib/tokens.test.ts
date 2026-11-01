import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../i18n";
import { addTokens, callTokens, estimateTextTokens, formatTokens, readTokens } from "./tokens";

afterEach(() => setLocale("en"));

describe("tokens (spec 6.6, decision 87)", () => {
  it("estimates mixed text: one per Chinese character, words × 4/3 for the rest", () => {
    expect(estimateTextTokens("one two three")).toBe(4);
    expect(estimateTextTokens("林峰笑了")).toBe(4);
    expect(estimateTextTokens("Lin Feng 笑了")).toBe(2 + 3);
    expect(estimateTextTokens("")).toBe(0);
  });

  it("takes the provider's report, or estimates and marks it", () => {
    const messages = [{ role: "user" as const, content: "one two three" }];
    expect(callTokens({ input: 10, output: 5 }, messages, "x")).toEqual({ input: 10, output: 5 });
    expect(callTokens(null, messages, "林峰")).toEqual({ input: 4, output: 2, estimated: true });
  });

  it("adds up, staying estimated once any part was", () => {
    expect(addTokens(undefined, { input: 1, output: 2 })).toEqual({ input: 1, output: 2 });
    expect(addTokens({ input: 1, output: 2 }, undefined)).toEqual({ input: 1, output: 2 });
    expect(addTokens({ input: 1, output: 2 }, { input: 3, output: 4 })).toEqual({ input: 4, output: 6 });
    expect(addTokens({ input: 1, output: 2, estimated: true }, { input: 3, output: 4 })).toEqual({ input: 4, output: 6, estimated: true });
  });

  it("reads tokens from a file, ignoring junk", () => {
    expect(readTokens({ input: "12", output: 3 })).toEqual({ input: 12, output: 3 });
    expect(readTokens({ input: 1, output: 2, estimated: true })).toEqual({ input: 1, output: 2, estimated: true });
    expect(readTokens({ input: "x", output: 2 })).toBeUndefined();
    expect(readTokens("lots")).toBeUndefined();
    expect(readTokens(null)).toBeUndefined();
  });

  it("formats in the UI language, with ≈ when estimated", () => {
    expect(formatTokens({ input: 4800, output: 1200 })).toBe("4,800 in · 1,200 out tokens");
    expect(formatTokens({ input: 10, output: 2, estimated: true })).toBe("≈ 10 in · 2 out tokens (estimated)");
    setLocale("zh-Hant");
    expect(formatTokens({ input: 4800, output: 1200 })).toBe("輸入 4,800・輸出 1,200 token");
  });
});
