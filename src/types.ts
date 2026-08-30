export type NodeKind = "folder" | "chapter" | "note" | "character" | "reference";

/**
 * The four permanent top-level folders. Mirrors `NodeRole` in
 * `src-tauri/src/project.rs`, which recreates any that go missing on load.
 */
export type NodeRole = "manuscript" | "references" | "characters" | "notes";

export interface BinderNode {
  id: string;
  title: string;
  kind: NodeKind;
  children: BinderNode[];
  file?: string;
  url?: string;
  expanded: boolean;
  included: boolean;
  /** Set on the four permanent roots, absent on everything the writer makes. */
  role?: NodeRole;
}

/** A deleted item, kept so it can be restored. Its files are still on disk. */
export interface TrashedItem {
  node: BinderNode;
  parentId?: string;
  index: number;
  deletedAt: string;
}

/** Word goals. Zero means none set. */
export interface Targets {
  manuscript: number;
  daily: number;
}

export interface Project {
  schemaVersion: number;
  title: string;
  author: string;
  created: string;
  modified: string;
  roots: BinderNode[];
  manuscriptRootId: string;
  /** Newest first. Outside the tree: never searched, counted or compiled. */
  trash: TrashedItem[];
  targets: Targets;
}

export interface OpenedProject {
  path: string;
  project: Project;
}

/** One day in the progress ledger: the manuscript count when the day was
 *  first seen, and the latest count since. */
export interface Day {
  date: string;
  start: number;
  end: number;
}

export interface ManuscriptStats {
  words: number;
  documents: number;
  /** Ascending by date; today's entry is current as of this count. */
  days: Day[];
}

/** Today as `YYYY-MM-DD` in local time — the key the progress ledger uses. */
export function localDate(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A dated copy of one document's text, kept under `snapshots/<id>/`. */
export interface Snapshot {
  name: string;
  /** RFC 3339, UTC. */
  takenAt: string;
  words: number;
}

export type SearchSource = "title" | "body" | "outline";

/** One match from project-wide search. Offsets are UTF-16 units, which is
 *  what both `String.slice` and the editor's `setSelectionRange` count. */
export interface SearchHit {
  id: string;
  title: string;
  source: SearchSource;
  offset: number;
  length: number;
  snippet: string;
  snippetOffset: number;
  snippetLength: number;
}

export interface SearchResults {
  hits: SearchHit[];
  truncated: boolean;
}

export type Provider = "anthropic" | "openai" | "gemini" | "local";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type Theme = "system" | "light" | "dark" | "sepia";
export type EditorFont = "serif" | "sans" | "mono";

export interface Settings {
  provider: Provider;
  model: string;
  effort: Effort;
  showReasoning: boolean;
  theme: Theme;
  editorFont: EditorFont;
  editorFontSize: number;
  editorLineHeight: number;
  editorMeasure: number;
  spellCheck: boolean;
  recent: string[];
}

export interface KeyStatus {
  configured: boolean;
  backend: "osKeychain" | "localFile" | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
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
