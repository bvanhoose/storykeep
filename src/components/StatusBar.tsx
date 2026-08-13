import type { BinderNode, ManuscriptStats } from "../types";

interface StatusBarProps {
  node: BinderNode | null;
  documentWords: number;
  stats: ManuscriptStats;
  saving: boolean;
  savedAt: string | null;
}

const format = (n: number) => n.toLocaleString();

export function StatusBar({ node, documentWords, stats, saving, savedAt }: StatusBarProps) {
  return (
    <footer className="statusbar">
      <span className="stat">
        {node ? (
          <>
            <b>{format(documentWords)}</b> {documentWords === 1 ? "word" : "words"} here
          </>
        ) : (
          "—"
        )}
      </span>
      <span className="stat">
        <b>{format(stats.words)}</b> in the manuscript
      </span>
      <span className="stat">
        {stats.documents} {stats.documents === 1 ? "chapter" : "chapters"}
      </span>
      <span className="stat-spacer" />
      <span className={saving ? "stat saving" : "stat"}>
        {saving ? "Saving…" : savedAt ? `Saved ${savedAt}` : "Saved"}
      </span>
    </footer>
  );
}
