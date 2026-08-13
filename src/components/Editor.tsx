import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BinderNode, Settings } from "../types";

interface EditorProps {
  node: BinderNode | null;
  body: string;
  loading: boolean;
  settings: Settings;
  /** Position of this document in the manuscript, for the ribbon. */
  place: { index: number; total: number } | null;
  onBodyChange: (value: string) => void;
  onTitleChange: (title: string) => void;
}

export function Editor({
  node,
  body,
  loading,
  settings,
  place,
  onBodyChange,
  onTitleChange,
}: EditorProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const [progress, setProgress] = useState(0);

  // Grow the textarea to fit, so the whole document scrolls as one page
  // instead of a box inside a page.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body, settings.editorFontSize, settings.editorLineHeight, settings.editorFont, node?.id]);

  // A new document starts at the top, not wherever the last one was left.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    setProgress(0);
  }, [node?.id]);

  if (!node) {
    return (
      <main className="editor">
        <div className="empty">
          <p>Pick something from the binder to start writing.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="editor">
      <div
        className="editor-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          const range = el.scrollHeight - el.clientHeight;
          setProgress(range > 0 ? el.scrollTop / range : 0);
        }}
      >
        <div
          className="editor-col"
          data-font={settings.editorFont}
          style={{
            ["--editor-size" as string]: `${settings.editorFontSize}px`,
            ["--editor-leading" as string]: settings.editorLineHeight,
            ["--editor-measure" as string]: `calc(${settings.editorMeasure}ch + 64px)`,
          }}
        >
          <input
            className="doc-title"
            value={node.title}
            spellCheck={false}
            placeholder="Untitled"
            aria-label="Document title"
            onChange={(e) => onTitleChange(e.currentTarget.value)}
          />
          <div className="doc-rule" />
          <textarea
            ref={area}
            className="doc-body"
            data-font={settings.editorFont}
            value={loading ? "" : body}
            spellCheck={settings.spellCheck}
            placeholder={loading ? "" : placeholderFor(node)}
            aria-label="Document text"
            onChange={(e) => onBodyChange(e.currentTarget.value)}
            onKeyDown={(e) => handleMarkup(e, onBodyChange)}
          />
        </div>
      </div>

      {place && place.total > 1 && <Ribbon place={place} progress={progress} />}
    </main>
  );
}

function Ribbon({
  place,
  progress,
}: {
  place: { index: number; total: number };
  progress: number;
}) {
  const top = (place.index / place.total) * 100;
  const height = (1 / place.total) * 100;
  return (
    <div
      className="ribbon"
      title={`${ordinal(place.index + 1)} of ${place.total} in the manuscript`}
      aria-hidden="true"
    >
      <div className="ribbon-span" style={{ top: `${top}%`, height: `${height}%` }} />
      <div className="ribbon-bead" style={{ top: `${top + height * progress}%` }} />
    </div>
  );
}

/** Ctrl/Cmd+B and Ctrl/Cmd+I wrap the selection in Markdown emphasis. */
function handleMarkup(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
  onChange: (value: string) => void,
) {
  if (!(event.metaKey || event.ctrlKey)) return;
  const key = event.key.toLowerCase();
  const marker = key === "b" ? "**" : key === "i" ? "*" : null;
  if (!marker) return;

  event.preventDefault();
  const el = event.currentTarget;
  const { selectionStart: start, selectionEnd: end, value } = el;
  const selected = value.slice(start, end);

  // Toggle off if the selection is already wrapped.
  const before = value.slice(Math.max(0, start - marker.length), start);
  const after = value.slice(end, end + marker.length);
  if (before === marker && after === marker) {
    const next =
      value.slice(0, start - marker.length) + selected + value.slice(end + marker.length);
    onChange(next);
    queueMicrotask(() => el.setSelectionRange(start - marker.length, end - marker.length));
    return;
  }

  onChange(value.slice(0, start) + marker + selected + marker + value.slice(end));
  queueMicrotask(() => el.setSelectionRange(start + marker.length, end + marker.length));
}

function placeholderFor(node: BinderNode): string {
  switch (node.kind) {
    case "character":
      return "Who are they, and what do they want badly enough to carry a scene?";
    case "note":
      return "Anything that doesn't belong in the manuscript yet.";
    default:
      return "Start writing.";
  }
}

function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
