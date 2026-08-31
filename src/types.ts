/**
 * Shapes shared with the Rust side.
 *
 * Everything that crosses the IPC boundary is generated from the Rust
 * structs by ts-rs into `src/generated/` — run `npm run types` after
 * changing a `#[ts(export)]` type — and re-exported here so the rest of the
 * app has one place to import from. Only what the window adds on top of
 * those shapes is written by hand below.
 */

export type { AiDone } from "./generated/AiDone";
export type { AiError } from "./generated/AiError";
export type { AiText } from "./generated/AiText";
export type { BinderNode } from "./generated/BinderNode";
export type { ChatRequest } from "./generated/ChatRequest";
export type { ChatTurn } from "./generated/ChatTurn";
export type { Day } from "./generated/Day";
export type { EditorFont } from "./generated/EditorFont";
export type { Effort } from "./generated/Effort";
export type { KeyBackend } from "./generated/KeyBackend";
export type { KeyStatus } from "./generated/KeyStatus";
export type { ManuscriptStats } from "./generated/ManuscriptStats";
export type { NodeKind } from "./generated/NodeKind";
export type { NodeRole } from "./generated/NodeRole";
export type { OpenedProject } from "./generated/OpenedProject";
export type { Project } from "./generated/Project";
export type { Provider } from "./generated/Provider";
export type { SearchHit } from "./generated/SearchHit";
export type { SearchResults } from "./generated/SearchResults";
export type { SearchSource } from "./generated/SearchSource";
export type { Settings } from "./generated/Settings";
export type { Snapshot } from "./generated/Snapshot";
export type { Targets } from "./generated/Targets";
export type { Theme } from "./generated/Theme";
export type { TrashedItem } from "./generated/TrashedItem";

import type { BinderNode } from "./generated/BinderNode";
import type { ChatTurn } from "./generated/ChatTurn";
import type { NodeKind } from "./generated/NodeKind";
import type { Provider } from "./generated/Provider";

/** A turn as the panel keeps it: what was sent, plus what only the window
 *  cares about. Stripped back to a `ChatTurn` before it reaches Rust. */
export interface ChatMessage extends ChatTurn {
  role: "user" | "assistant";
  reasoning?: string;
  /** Set when the turn ended badly, so the panel can style it as a problem. */
  error?: boolean;
}

export const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Claude",
  openai: "ChatGPT",
  gemini: "Gemini",
  local: "Local model",
};

/**
 * Whether this is one of the four fixtures. They always exist, so the binder
 * refuses to rename or delete them; folders the writer adds are free.
 */
export function isFixedRoot(node: BinderNode): boolean {
  return node.role !== undefined;
}

/** Kinds that own a text body. Mirrors `NodeKind::has_document` in Rust. */
export function hasDocument(kind: NodeKind): boolean {
  return kind === "chapter" || kind === "note" || kind === "character";
}

/**
 * Word count for the live editor.
 *
 * Kept deliberately in step with `project::word_count` in
 * `src-tauri/src/project.rs`, which produces the manuscript total. Both are
 * tested against `fixtures/word-count.json`, so a change to one fails the
 * other's tests until it is mirrored.
 *
 * `\p{Alphabetic}` rather than `\p{L}`: Rust's `is_alphanumeric` is the
 * Alphabetic property, which also covers letter-like symbols such as Ⓐ.
 */
export function countWords(text: string): number {
  let total = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (/^[-*_#]+$/.test(trimmed)) continue;
    for (const word of trimmed.split(/\s+/)) {
      if (/[\p{Alphabetic}\p{N}]/u.test(word)) total += 1;
    }
  }
  return total;
}

/** Today as `YYYY-MM-DD` in local time — the key the progress ledger uses. */
export function localDate(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
