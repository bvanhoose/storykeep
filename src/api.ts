/**
 * Typed wrappers around the Rust commands. The rest of the app never calls
 * `invoke` directly, so the boundary is in one place.
 *
 * Who owns what: the window owns the binder tree between saves, and the
 * Rust side keeps no project state at all. Commands that need the tree —
 * the word count, search, export — take the whole `Project` as an argument
 * rather than holding a copy of their own. That is deliberate: there is
 * exactly one copy of the tree, so nothing can go stale, and every command
 * is a function of its arguments and the disk. The cost is that the tree
 * crosses the IPC boundary on those calls; a binder is a few kilobytes of
 * JSON, which is noise beside the chapter files those commands then read.
 * Document text is the exception: it is read and written by id and never
 * held on both sides.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AiDone,
  AiError,
  AiText,
  BinderNode,
  ChatMessage,
  ChatRequest,
  KeyStatus,
  ManuscriptStats,
  NodeKind,
  OpenedProject,
  Project,
  Provider,
  SearchResults,
  Settings,
  Snapshot,
} from "./types";

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),

  keyStatus: (provider: Provider) => invoke<KeyStatus>("key_status", { provider }),
  setApiKey: (provider: Provider, key: string) =>
    invoke<KeyStatus>("set_api_key", { provider, key }),
  clearApiKey: (provider: Provider) => invoke<void>("clear_api_key", { provider }),

  createProject: (parent: string, name: string) =>
    invoke<OpenedProject>("create_project", { parent, name }),
  openProject: (path: string) => invoke<OpenedProject>("open_project", { path }),
  forgetProject: (path: string) => invoke<void>("forget_project", { path }),
  saveProjectMeta: (path: string, project: Project) =>
    invoke<void>("save_project_meta", { path, project }),

  readDocument: (path: string, id: string) => invoke<string>("read_document", { path, id }),
  writeDocument: (path: string, id: string, text: string) =>
    invoke<void>("write_document", { path, id, text }),
  readOutline: (path: string, id: string) => invoke<string>("read_outline", { path, id }),
  writeOutline: (path: string, id: string, text: string) =>
    invoke<void>("write_outline", { path, id, text }),
  purgeNodes: (path: string, nodes: BinderNode[]) => invoke<void>("purge_nodes", { path, nodes }),

  takeSnapshot: (path: string, id: string, text: string) =>
    invoke<Snapshot>("take_snapshot", { path, id, text }),
  listSnapshots: (path: string, id: string) => invoke<Snapshot[]>("list_snapshots", { path, id }),
  readSnapshot: (path: string, id: string, name: string) =>
    invoke<string>("read_snapshot", { path, id, name }),
  deleteSnapshot: (path: string, id: string, name: string) =>
    invoke<void>("delete_snapshot", { path, id, name }),

  importReference: (path: string, source: string) =>
    invoke<string>("import_reference", { path, source }),
  referenceFullPath: (path: string, name: string) =>
    invoke<string>("reference_full_path", { path, name }),

  /** `today` is the local date; the count is recorded against it. */
  manuscriptStats: (path: string, project: Project, today: string) =>
    invoke<ManuscriptStats>("manuscript_stats", { path, project, today }),
  searchProject: (path: string, project: Project, query: string) =>
    invoke<SearchResults>("search_project", { path, project, query }),
  exportManuscript: (path: string, project: Project, format: string, destination: string) =>
    invoke<string>("export_manuscript", { path, project, format, destination }),
  suggestedExportName: (project: Project, format: string) =>
    invoke<string>("suggested_export_name", { project, format }),

  newNode: (title: string, kind: NodeKind) => invoke<BinderNode>("new_node", { title, kind }),

  aiSend: (request: Omit<ChatRequest, "messages"> & { messages: ChatMessage[] }) => {
    // Strip UI-only fields before they reach the provider.
    const wire: ChatRequest = {
      ...request,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    return invoke<void>("ai_send", { request: wire });
  },
  aiCancel: () => invoke<void>("ai_cancel"),
};

/** Subscribe to the assistant's stream. Returns a single unsubscribe function.
 *  Every event names the request it belongs to, so a late event from a turn
 *  that was stopped or replaced can be told apart and dropped. */
export async function listenToAssistant(handlers: {
  onDelta: (delta: AiText) => void;
  onReasoning: (delta: AiText) => void;
  onDone: (done: AiDone) => void;
  onError: (error: AiError) => void;
}): Promise<UnlistenFn> {
  const unlisteners = await Promise.all([
    listen<AiText>("ai:delta", (e) => handlers.onDelta(e.payload)),
    listen<AiText>("ai:reasoning", (e) => handlers.onReasoning(e.payload)),
    listen<AiDone>("ai:done", (e) => handlers.onDone(e.payload)),
    listen<AiError>("ai:error", (e) => handlers.onError(e.payload)),
  ]);
  return () => unlisteners.forEach((off) => off());
}

/** Tauri errors arrive as plain strings; anything else gets a readable fallback. */
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}
