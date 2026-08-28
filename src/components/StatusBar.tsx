import { localDate, type BinderNode, type ManuscriptStats, type Targets } from "../types";

interface StatusBarProps {
  node: BinderNode | null;
  documentWords: number;
  stats: ManuscriptStats;
  targets: Targets;
  saving: boolean;
  savedAt: string | null;
}

const format = (n: number) => n.toLocaleString();

export function StatusBar({ node, documentWords, stats, targets, saving, savedAt }: StatusBarProps) {
  const today = stats.days.find((d) => d.date === localDate());
  const written = today ? today.end - today.start : null;

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
        {targets.manuscript > 0 && (
          <Meter
            value={stats.words}
            goal={targets.manuscript}
            title={`${format(stats.words)} of ${format(targets.manuscript)} words`}
          />
        )}
      </span>
      <span className="stat">
        {stats.documents} {stats.documents === 1 ? "chapter" : "chapters"}
      </span>
      {written !== null && (
        <span className="stat" data-tone={written < 0 ? "cut" : undefined}>
          <b>{signed(written)}</b> today
          {targets.daily > 0 && (
            <Meter
              value={Math.max(0, written)}
              goal={targets.daily}
              title={`${format(Math.max(0, written))} of ${format(targets.daily)} today`}
            />
          )}
        </span>
      )}
      <span className="stat-spacer" />
      <span className={saving ? "stat saving" : "stat"}>
        {saving ? "Saving…" : savedAt ? `Saved ${savedAt}` : "Saved"}
      </span>
    </footer>
  );
}

/** A thin bar that fills toward a goal; brass once the goal is met. */
function Meter({ value, goal, title }: { value: number; goal: number; title: string }) {
  const share = Math.min(1, value / goal);
  return (
    <span className="meter" title={title} data-met={share >= 1 ? "true" : undefined}>
      <span className="meter-fill" style={{ width: `${share * 100}%` }} />
    </span>
  );
}

function signed(n: number): string {
  if (n > 0) return `+${format(n)}`;
  if (n < 0) return `−${format(-n)}`;
  return "0";
}
