import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BinderNode, Settings } from "../types";

/** A request to select a passage — from a search hit — once its document is
 *  the one on the page. `seq` makes each request distinct even at the same spot. */
export interface Jump {
  id: string;
  offset: number;
  length: number;
  seq: number;
}

interface EditorProps {
  node: BinderNode | null;
  body: string;
  loading: boolean;
  settings: Settings;
  /** Position of this document in the manuscript, for the ribbon. */
  place: { index: number; total: number } | null;
  /** Only passed once `body` belongs to `jump.id`; null otherwise. */
  jump: Jump | null;
  onBodyChange: (value: string) => void;
  onTitleChange: (title: string) => void;
}

export function Editor({
  node,
  body,
  loading,
  settings,
  place,
  jump,
  onBodyChange,
  onTitleChange,
}: EditorProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const [progress, setProgress] = useState(0);
  const jumped = useRef(0);

  // Select the requested passage and bring it into view. The textarea is
  // the full height of the document, so focusing it scrolls nothing; the
  // position has to be measured and the page scrolled by hand.
  useEffect(() => {
    const el = area.current;
    const page = scroller.current;
    if (!jump || !el || !page || !node || node.id !== jump.id) return;
    if (jumped.current === jump.seq || jump.offset > body.length) return;
    jumped.current = jump.seq;

    el.focus({ preventScroll: true });
    el.setSelectionRange(jump.offset, jump.offset + jump.length);
    const withinArea = caretTop(el, jump.offset);
    const areaTop =
      el.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop;
    page.scrollTo({ top: Math.max(0, areaTop + withinArea - page.clientHeight * 0.35) });
  }, [jump, node, body]);

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

/**
 * How far down a textarea a character position sits.
 *
 * A textarea won't say where its text wraps, so the text up to `offset` is
 * laid out again in a hidden block carrying the same typography and width,
 * and the next character's position is read off that.
 */
function caretTop(el: HTMLTextAreaElement, offset: number): number {
  const mirror = document.createElement("div");
  const style = getComputedStyle(el);
  for (const prop of [
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "line-height",
    "letter-spacing",
    "word-spacing",
    "tab-size",
    "text-indent",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "border-top-width",
    "border-right-width",
    "border-left-width",
    "box-sizing",
  ]) {
    mirror.style.setProperty(prop, style.getPropertyValue(prop));
  }
  mirror.style.position = "absolute";
  mirror.style.top = "0";
  mirror.style.left = "-10000px";
  mirror.style.width = `${el.offsetWidth}px`;
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";

  mirror.textContent = el.value.slice(0, offset);
  const marker = document.createElement("span");
  marker.textContent = el.value.slice(offset, offset + 1) || "\u200b";
  mirror.appendChild(marker);

  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  mirror.remove();
  return top;
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
