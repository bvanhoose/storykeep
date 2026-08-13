import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage } from "../types";

export interface SendOptions {
  useChapter: boolean;
  useOutline: boolean;
  useSelection: boolean;
}

interface AssistantProps {
  ready: boolean;
  providerLabel: string;
  modelLabel: string;
  messages: ChatMessage[];
  streaming: boolean;
  hasDocument: boolean;
  selection: string;
  onSend: (text: string, options: SendOptions) => void;
  onStop: () => void;
  onClear: () => void;
  onOpenSettings: () => void;
}

const STARTERS = [
  ["Read the chapter", "Read this chapter and tell me what's working and what isn't."],
  ["Where does it drag?", "Where does the pacing sag in this chapter, and why?"],
  ["Continuity check", "Check this chapter against the outline for continuity problems."],
] as const;

export function Assistant({
  ready,
  providerLabel,
  modelLabel,
  messages,
  streaming,
  hasDocument,
  selection,
  onSend,
  onStop,
  onClear,
  onOpenSettings,
}: AssistantProps) {
  const [draft, setDraft] = useState("");
  const [useChapter, setUseChapter] = useState(true);
  const [useOutline, setUseOutline] = useState(true);
  const [useSelection, setUseSelection] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  const hasSelection = selection.trim().length > 0;
  useEffect(() => {
    if (!hasSelection) setUseSelection(false);
  }, [hasSelection]);

  // Follow the stream, but don't yank the view if they've scrolled up to read.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useLayoutEffect(() => {
    const el = composer.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    onSend(trimmed, { useChapter, useOutline, useSelection: useSelection && hasSelection });
    setDraft("");
  };

  if (!ready) {
    return (
      <div className="pane">
        <div className="empty">
          <p>
            The assistant needs a {providerLabel} API key before it can read anything or
            answer.
          </p>
          <p>
            <button type="button" className="btn" onClick={onOpenSettings}>
              Add a key in Settings
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="pane">
      <div className="chat" ref={scroller}>
        {messages.length === 0 ? (
          <div className="empty">
            <p>
              Ask about the chapter you're in. It reads the text and the outline you've
              ticked below, and nothing else.
            </p>
          </div>
        ) : (
          messages.map((message, i) => (
            <Turn
              key={i}
              message={message}
              streaming={streaming && i === messages.length - 1 && message.role === "assistant"}
            />
          ))
        )}
      </div>

      {messages.length === 0 && hasDocument && (
        <div className="chip-row">
          {STARTERS.map(([label, prompt]) => (
            <button key={label} type="button" className="chip" onClick={() => send(prompt)}>
              {label}
            </button>
          ))}
          {hasSelection && (
            <button
              type="button"
              className="chip"
              onClick={() => {
                setUseSelection(true);
                send("Tighten the selected passage. Keep my voice.");
              }}
            >
              Tighten the selection
            </button>
          )}
        </div>
      )}

      <div className="composer">
        <textarea
          ref={composer}
          rows={2}
          value={draft}
          placeholder="Ask about the draft…"
          aria-label="Message the assistant"
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
        />
        <div className="composer-row">
          <button
            type="button"
            className="chip"
            aria-pressed={useChapter}
            disabled={!hasDocument}
            onClick={() => setUseChapter((v) => !v)}
            title="Send the open document as context"
          >
            Chapter
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={useOutline}
            disabled={!hasDocument}
            onClick={() => setUseOutline((v) => !v)}
            title="Send the outline as context"
          >
            Outline
          </button>
          {hasSelection && (
            <button
              type="button"
              className="chip"
              aria-pressed={useSelection}
              onClick={() => setUseSelection((v) => !v)}
              title="Point the assistant at the selected passage"
            >
              Selection
            </button>
          )}
          <span className="stat-spacer" />
          {streaming ? (
            <button type="button" className="chip" onClick={onStop}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="chip"
              onClick={() => send(draft)}
              disabled={draft.trim().length === 0}
            >
              Send
            </button>
          )}
        </div>
        <div className="composer-row">
          <span className="composer-hint">
            {providerLabel} · {modelLabel}
          </span>
          {messages.length > 0 && !streaming && (
            <button type="button" className="turn-copy" onClick={onClear}>
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Turn({ message, streaming }: { message: ChatMessage; streaming: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="turn" data-role={message.role} data-error={message.error ? "true" : undefined}>
      <div className="turn-who">{message.role === "user" ? "You" : "Assistant"}</div>
      {message.reasoning && (
        <details className="turn-reasoning">
          <summary>Reasoning</summary>
          <p>{message.reasoning}</p>
        </details>
      )}
      <div className={streaming ? "turn-text caret" : "turn-text"}>{message.content}</div>
      {message.role === "assistant" && !streaming && message.content && !message.error && (
        <button
          type="button"
          className="turn-copy"
          onClick={() => {
            void navigator.clipboard.writeText(message.content);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      )}
    </div>
  );
}
