import { describe, expect, it } from "vitest";
import { formatMarkDoc, parseMarkDoc } from "./markdoc";

describe("parseMarkDoc", () => {
  it("reads the YAML header and the body", () => {
    const doc = parseMarkDoc("---\nname: Lin Feng\nage: 19\n---\n\nA boy from a poor village.\n");
    expect(doc.header).toEqual({ name: "Lin Feng", age: 19 });
    expect(doc.body).toBe("A boy from a poor village.");
  });

  it("treats a file without a header as body only", () => {
    expect(parseMarkDoc("  Just text.\n")).toEqual({ header: {}, body: "Just text." });
  });

  it("strips a byte-order mark and accepts CRLF line endings", () => {
    const doc = parseMarkDoc("﻿---\r\nname: Mei\r\n---\r\nBody\r\n");
    expect(doc.header).toEqual({ name: "Mei" });
    expect(doc.body).toBe("Body");
  });

  it("does not end the header at --- inside a value", () => {
    const doc = parseMarkDoc("---\nnote: a---b\n---\nBody");
    expect(doc.header).toEqual({ note: "a---b" });
    expect(doc.body).toBe("Body");
  });

  it("reads an empty header", () => {
    expect(parseMarkDoc("---\n---\nBody")).toEqual({ header: {}, body: "Body" });
  });

  it("throws a readable error for invalid YAML", () => {
    expect(() => parseMarkDoc("---\nname: [unclosed\n---\n")).toThrow(/YAML header could not be read/);
  });

  it("throws when the header is a list instead of fields", () => {
    expect(() => parseMarkDoc("---\n- a\n- b\n---\n")).toThrow(/list of fields/);
  });
});

describe("formatMarkDoc", () => {
  it("writes short plain lists on one line (decision 29)", () => {
    const text = formatMarkDoc({ header: { stages: ["Early", "Middle", "Late"] }, body: "" });
    expect(text).toContain("stages: [Early, Middle, Late]");
  });

  it("writes long lists as a block", () => {
    const long = Array.from({ length: 8 }, (_, i) => `A fairly long item number ${i}`);
    const text = formatMarkDoc({ header: { items: long }, body: "" });
    expect(text).toContain("items:\n  - A fairly long item number 0");
  });

  it("writes no body section when the body is empty", () => {
    expect(formatMarkDoc({ header: { a: 1 }, body: "   " })).toBe("---\na: 1\n---\n");
  });

  it("keeps long text on one line", () => {
    const long = "word ".repeat(60).trim();
    expect(formatMarkDoc({ header: { goals: long }, body: "" })).toContain(`goals: ${long}\n`);
  });

  it("round-trips Chinese text, colons, quotes and nested lists (decision 28)", () => {
    const doc = {
      header: {
        name: "林风",
        speech_style: 'Says "hmph": often',
        rank_ladder: [{ name: "练气", stages: ["初期", "中期"] }],
        age: 19,
        empty: null,
      },
      body: "他出生在一个小村庄。\n\nSecond paragraph: with a colon.",
    };
    expect(parseMarkDoc(formatMarkDoc(doc))).toEqual(doc);
  });
});
