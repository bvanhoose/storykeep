import { useMemo } from "react";
import { diffLines, type DiffLine } from "../diff";
import type { BinderNode, Snapshot } from "../types";

interface HistoryProps {
  node: BinderNode | null;
  snapshots: Snapshot[];
  /** What the page says now, to diff a snapshot against. */
  currentBody: string;
  /** The snapshot being looked at, once its text has loaded. */
  viewing: { name: string; text: string } | null;
  onTake: () => void;
  onView: (name: string | null) => void;
  onRestore: (name: string) => void;
  onDelete: (name: string) => void;
}

export function History({
  node,
  snapshots,
  currentBody,
  viewing,
  onTake,
  onView,
  onRestore,
  onDelete,
}: HistoryProps) {
  if (!node) {
    return (
      <div className="pane">
        <div className="empty">
          <p>Snapshots are kept per document. Open one to see its history.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pane">
      <div className="pane-head history-head">
        <span className="history-title">{node.title}</span>
        <button type="button" className="chip" onClick={onTake} title="Ctrl Shift S">
          Take snapshot
        </button>
      </div>

      {snapshots.length === 0 ? (
        <div className="empty">
          <p>No snapshots of this document yet.</p>
          <p>
            One is taken by itself the first time you edit each day; Ctrl Shift S takes one whenever
            you like, before a rewrite you might regret.
          </p>
        </div>
      ) : (
        <>
          <div className="history-list" role="listbox" aria-label="Snapshots">
            {snapshots.map((snap) => (
              <button
                key={snap.name}
                type="button"
                className="snap"
                role="option"
                aria-selected={viewing?.name === snap.name}
                onClick={() => onView(viewing?.name === snap.name ? null : snap.name)}
              >
                <span className="snap-when">{when(snap.takenAt)}</span>
                <span className="snap-words">
                  {snap.words.toLocaleString()} {snap.words === 1 ? "word" : "words"}
                </span>
              </button>
            ))}
          </div>

          {viewing ? (
            <Detail
              viewing={viewing}
              currentBody={currentBody}
              onRestore={() => onRestore(viewing.name)}
              onDelete={() => onDelete(viewing.name)}
            />
          ) : (
            <div className="empty">
              <p>Pick a snapshot to see what has changed since.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Detail({
  viewing,
  currentBody,
  onRestore,
  onDelete,
}: {
  viewing: { name: string; text: string };
  currentBody: string;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const diff = useMemo(() => diffLines(viewing.text, currentBody), [viewing.text, currentBody]);
  const added = diff?.filter((l) => l.kind === "add").length ?? 0;
  const removed = diff?.filter((l) => l.kind === "del").length ?? 0;

  return (
    <div className="history-detail">
      <div className="history-actions">
        <span className="history-summary">
          {diff === null
            ? "Too long to compare; showing the snapshot."
            : added === 0 && removed === 0
              ? "Same as the page now."
              : `Since then: ${added} ${added === 1 ? "line" : "lines"} added, ${removed} removed.`}
        </span>
        <button type="button" className="turn-copy" onClick={onRestore}>
          Restore
        </button>
        <button type="button" className="turn-copy" onClick={onDelete}>
          Delete
        </button>
      </div>
      <div className="diff">
        {diff === null
          ? viewing.text.split("\n").map((text, i) => (
              <div key={i} className="diff-line" data-kind="same">
                {text || " "}
              </div>
            ))
          : fold(diff).map((item, i) =>
              "skipped" in item ? (
                <div key={i} className="diff-fold">
                  {item.skipped} unchanged {item.skipped === 1 ? "line" : "lines"}
                </div>
              ) : (
                <div key={i} className="diff-line" data-kind={item.kind}>
                  {item.text || " "}
                </div>
              ),
            )}
      </div>
    </div>
  );
}

/** Keep two lines of context around each change; fold the rest. */
function fold(lines: DiffLine[]): (DiffLine | { skipped: number })[] {
  const CONTEXT = 2;
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, i) => {
    if (line.kind === "same") return;
    for (let k = Math.max(0, i - CONTEXT); k <= Math.min(lines.length - 1, i + CONTEXT); k++) {
      keep[k] = true;
    }
  });

  const out: (DiffLine | { skipped: number })[] = [];
  let skipped = 0;
  lines.forEach((line, i) => {
    if (keep[i]) {
      if (skipped > 0) out.push({ skipped });
      skipped = 0;
      out.push(line);
    } else {
      skipped++;
    }
  });
  if (skipped > 0) out.push({ skipped });
  return out;
}

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? `Today, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}
