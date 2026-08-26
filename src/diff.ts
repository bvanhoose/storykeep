/** A line-by-line diff, for showing what changed since a snapshot. */

export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

/** Past this many lines a side, the table gets too big to be worth it. */
const LIMIT = 1500;

/**
 * Lines of `before` and `after` aligned by longest common subsequence.
 * "del" lines are in `before` only, "add" lines in `after` only.
 *
 * Returns null when either side is too long; callers fall back to showing
 * the older text plain.
 */
export function diffLines(before: string, after: string): DiffLine[] | null {
  const a = before.split("\n");
  const b = after.split("\n");

  // Peel off the common head and tail: most edits touch a small region, and
  // this keeps the table to that region.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tailA = a.length;
  let tailB = b.length;
  while (tailA > head && tailB > head && a[tailA - 1] === b[tailB - 1]) {
    tailA--;
    tailB--;
  }

  const x = a.slice(head, tailA);
  const y = b.slice(head, tailB);
  if (x.length > LIMIT || y.length > LIMIT) return null;

  const n = x.length;
  const m = y.length;
  const w = m + 1;
  const table = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * w + j] =
        x[i] === y[j]
          ? table[(i + 1) * w + j + 1] + 1
          : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
    }
  }

  const out: DiffLine[] = a.slice(0, head).map((text) => ({ kind: "same", text }));
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ kind: "same", text: x[i] });
      i++;
      j++;
    } else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) {
      out.push({ kind: "del", text: x[i] });
      i++;
    } else {
      out.push({ kind: "add", text: y[j] });
      j++;
    }
  }
  while (i < n) out.push({ kind: "del", text: x[i++] });
  while (j < m) out.push({ kind: "add", text: y[j++] });
  for (const text of a.slice(tailA)) out.push({ kind: "same", text });
  return out;
}
