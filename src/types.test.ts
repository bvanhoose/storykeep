import { describe, expect, it } from "vitest";
import cases from "../fixtures/word-count.json";
import { countWords, hasDocument, isFixedRoot, localDate } from "./types";

describe("countWords", () => {
  // The Rust word_count runs the same file; see project.rs.
  it.each(cases)("counts $words in $text", ({ text, words }) => {
    expect(countWords(text)).toBe(words);
  });
});

describe("localDate", () => {
  it("formats a local calendar date with zero padding", () => {
    expect(localDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(localDate(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });
});

describe("node helpers", () => {
  it("treats roled nodes as fixed and document kinds as documents", () => {
    const base = { id: "x", title: "x", children: [], expanded: true, included: true };
    expect(isFixedRoot({ ...base, kind: "folder", role: "notes" })).toBe(true);
    expect(isFixedRoot({ ...base, kind: "folder" })).toBe(false);
    expect(hasDocument("chapter")).toBe(true);
    expect(hasDocument("note")).toBe(true);
    expect(hasDocument("character")).toBe(true);
    expect(hasDocument("folder")).toBe(false);
    expect(hasDocument("reference")).toBe(false);
  });
});
