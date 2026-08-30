import { describe, expect, it } from "vitest";
import { diffLines } from "./diff";

/** Compact rendering: first letter of the kind, then the line. */
const render = (before: string, after: string) =>
  diffLines(before, after)
    ?.map((l) => `${l.kind[0]}:${l.text}`)
    .join("|");

describe("diffLines", () => {
  it("marks identical text as unchanged", () => {
    expect(render("a\nb\nc", "a\nb\nc")).toBe("s:a|s:b|s:c");
  });

  it("shows a replaced line as a removal then an addition", () => {
    expect(render("a\nb\nc", "a\nx\nc")).toBe("s:a|d:b|a:x|s:c");
  });

  it("handles pure insertions and deletions", () => {
    expect(render("a\nc", "a\nb\nc")).toBe("s:a|a:b|s:c");
    expect(render("a\nb\nc", "a\nc")).toBe("s:a|d:b|s:c");
  });

  it("treats empty text as one empty line", () => {
    expect(render("", "x")).toBe("d:|a:x");
    expect(render("x", "")).toBe("d:x|a:");
  });

  it("keeps a long common head and tail out of the table", () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
    const edited = [...lines.slice(0, 2500), "inserted", ...lines.slice(2500)];
    const diff = diffLines(lines.join("\n"), edited.join("\n"));
    expect(diff).not.toBeNull();
    expect(diff).toHaveLength(5001);
    expect(diff?.filter((l) => l.kind === "add")).toEqual([{ kind: "add", text: "inserted" }]);
  });

  it("gives up rather than build a huge table for two unrelated long texts", () => {
    const a = Array.from({ length: 2000 }, (_, i) => `a ${i}`).join("\n");
    const b = Array.from({ length: 2000 }, (_, i) => `b ${i}`).join("\n");
    expect(diffLines(a, b)).toBeNull();
  });
});
