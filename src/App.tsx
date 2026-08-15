import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { api, errorMessage, listenToAssistant } from "./api";
import { useDocumentBuffer, useDraggableWidth, useToast } from "./hooks";
import {
  allDocuments,
  breadcrumb,
  findNode,
  insertNode,
  locate,
  manuscriptDocuments,
  removeNode,
  roleRoot,
  rootContaining,
  shiftNode,
  updateNode,
} from "./tree";
import {
  countWords,
  hasDocument,
  isFixedRoot,
  PROVIDER_LABELS,
  type BinderNode,
  type ChatMessage,
  type ManuscriptStats,
  type NodeKind,
  type NodeRole,
  type OpenedProject,
  type Project,
  type Settings,
} from "./types";

import { Assistant, type SendOptions } from "./components/Assistant";
import { Binder } from "./components/Binder";
import {
  ConfirmDialog,
  NewProjectDialog,
  ProjectDetailsDialog,
  SettingsDialog,
} from "./components/Dialogs";
import { Editor } from "./components/Editor";
import { Outline, SidePanel, type SideTab } from "./components/SidePanel";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import { Welcome } from "./components/Welcome";

type Modal =
  | { kind: "settings" }
  | { kind: "newProject"; folder: string }
  | { kind: "details" }
  | { kind: "confirmDelete"; node: BinderNode }
  | null;

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [opened, setOpened] = useState<OpenedProject | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stats, setStats] = useState<ManuscriptStats>({ words: 0, documents: 0 });
  const [sideTab, setSideTab] = useState<SideTab>("outline");
  const [focusMode, setFocusMode] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [keyReady, setKeyReady] = useState(false);
  const [selection, setSelection] = useState("");

  const { toast, show } = useToast();
  const binderWidth = useDraggableWidth("sk.binderWidth", 232, 170, 420);
  const panelWidth = useDraggableWidth("sk.panelWidth", 300, 220, 520);

  const project = opened?.project ?? null;
  const path = opened?.path ?? null;
  const node = useMemo(
    () => (project ? findNode(project.roots, selectedId) : null),
    [project, selectedId],
  );
  const editing = node && hasDocument(node.kind) ? node : null;

  // Read through a ref so the callback stays stable: it is passed into the
  // document buffer, and a new identity on every keystroke would churn it.
  const openedRef = useRef<OpenedProject | null>(null);
  openedRef.current = opened;

  const refreshStats = useCallback(() => {
    const current = openedRef.current;
    if (!current) return;
    api
      .manuscriptStats(current.path, current.project)
      .then(setStats)
      .catch(() => undefined);
  }, []);

  const onDocSaved = useCallback(() => {
    setSavedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    refreshStats();
  }, [refreshStats]);

  const onError = useCallback((message: string) => show(message, "error"), [show]);

  const buffer = useDocumentBuffer(path, editing?.id ?? null, onDocSaved, onError);

  // --- settings -------------------------------------------------------------

  useEffect(() => {
    api.getSettings().then(setSettings).catch((e) => onError(errorMessage(e)));
  }, [onError]);

  const patchSettings = useCallback((next: Settings) => {
    setSettings(next);
    api.saveSettings(next).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!settings) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        settings.theme === "system" ? (media.matches ? "dark" : "light") : settings.theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings]);

  useEffect(() => {
    if (!settings) return;
    api
      .keyStatus(settings.provider)
      .then((status) => setKeyReady(status.configured))
      .catch(() => setKeyReady(false));
  }, [settings, modal]);

  // --- project --------------------------------------------------------------

  const adopt = useCallback((next: OpenedProject) => {
    setOpened(next);
    const first = allDocuments(next.project.roots)[0];
    setSelectedId(first?.id ?? next.project.roots[0]?.id ?? null);
    setChat([]);
  }, []);

  const saveMeta = useRef<number | undefined>(undefined);
  const commitProject = useCallback(
    (next: Project) => {
      if (!path) return;
      setOpened({ path, project: next });
      window.clearTimeout(saveMeta.current);
      saveMeta.current = window.setTimeout(() => {
        api
          .saveProjectMeta(path, next)
          .then(() => api.manuscriptStats(path, next).then(setStats))
          .catch((e) => onError(errorMessage(e)));
      }, 400);
    },
    [path, onError],
  );

  const openProjectAt = useCallback(
    async (target: string) => {
      try {
        adopt(await api.openProject(target));
      } catch (e) {
        onError(errorMessage(e));
      }
    },
    [adopt, onError],
  );

  const chooseAndOpen = useCallback(async () => {
    const picked = await openDialog({ directory: true, title: "Open a StoryKeep project" });
    if (typeof picked === "string") await openProjectAt(picked);
  }, [openProjectAt]);

  const startNewProject = useCallback(async () => {
    const folder = await openDialog({ directory: true, title: "Where should the project live?" });
    setModal({ kind: "newProject", folder: typeof folder === "string" ? folder : "" });
  }, []);

  useEffect(() => {
    refreshStats();
  }, [path, refreshStats]);

  // Reopen the most recent project on launch so writing starts immediately.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !settings || opened) return;
    restored.current = true;
    const last = settings.recent[0];
    if (last) void openProjectAt(last);
  }, [settings, opened, openProjectAt]);

  // --- binder ---------------------------------------------------------------

  const defaultParentFor = useCallback(
    (kind: NodeKind): { parentId: string | null; index: number } => {
      if (!project) return { parentId: null, index: 0 };

      // Which fixture owns this kind. A plain folder belongs wherever you are,
      // so it has no home of its own.
      const role: NodeRole | null =
        kind === "chapter"
          ? "manuscript"
          : kind === "character"
            ? "characters"
            : kind === "reference"
              ? "references"
              : kind === "note"
                ? "notes"
                : null;
      const home = role ? roleRoot(project.roots, role) : null;

      // Drop it beside the selection, but only when the selection already sits
      // in the right section — otherwise a selected note would swallow a new
      // character.
      const selectionFits =
        node && (!home || rootContaining(project.roots, node.id)?.id === home.id);
      if (node && selectionFits) {
        if (node.kind === "folder") return { parentId: node.id, index: node.children.length };
        const found = locate(project.roots, node.id);
        if (found) return { parentId: found.parent?.id ?? null, index: found.index + 1 };
      }

      const target = home ?? roleRoot(project.roots, "notes") ?? project.roots[0];
      return target
        ? { parentId: target.id, index: target.children.length }
        : { parentId: null, index: project.roots.length };
    },
    [project, node],
  );

  const addNode = useCallback(
    async (kind: NodeKind) => {
      if (!project) return;
      const title =
        kind === "chapter"
          ? `Chapter ${manuscriptDocuments(project).length + 1}`
          : kind === "folder"
            ? "New folder"
            : kind === "character"
              ? "New character"
              : "New note";
      try {
        const created = await api.newNode(title, kind);
        const { parentId, index } = defaultParentFor(kind);
        commitProject({ ...project, roots: insertNode(project.roots, parentId, index, created) });
        setSelectedId(created.id);
      } catch (e) {
        onError(errorMessage(e));
      }
    },
    [project, defaultParentFor, commitProject, onError],
  );

  const importReference = useCallback(async () => {
    if (!project || !path) return;
    const picked = await openDialog({ multiple: false, title: "Add a reference file" });
    if (typeof picked !== "string") return;
    try {
      const stored = await api.importReference(path, picked);
      const created = await api.newNode(stored, "reference");
      const { parentId, index } = defaultParentFor("reference");
      commitProject({
        ...project,
        roots: insertNode(project.roots, parentId, index, { ...created, file: stored }),
      });
      show(`Copied ${stored} into the project.`);
    } catch (e) {
      onError(errorMessage(e));
    }
  }, [project, path, defaultParentFor, commitProject, show, onError]);

  const openReference = useCallback(
    async (target: BinderNode) => {
      if (!path) return;
      try {
        if (target.url) await openUrl(target.url);
        else if (target.file) await openPath(await api.referenceFullPath(path, target.file));
      } catch (e) {
        onError(errorMessage(e));
      }
    },
    [path, onError],
  );

  const renameNode = useCallback(
    (id: string, title: string) => {
      if (!project) return;
      const target = findNode(project.roots, id);
      if (!target || isFixedRoot(target)) return;
      commitProject({ ...project, roots: updateNode(project.roots, id, { title }) });
    },
    [project, commitProject],
  );

  const deleteNode = useCallback(
    async (target: BinderNode) => {
      if (!project || !path || isFixedRoot(target)) return;
      const doomed = [target, ...allDocuments(target.children)];
      const { roots } = removeNode(project.roots, target.id);

      // Deleting something you were not looking at should not move you. Only
      // fall back when the open document is what just went.
      setSelectedId((current) =>
        current && findNode(roots, current)
          ? current
          : (allDocuments(roots)[0]?.id ?? roots[0]?.id ?? null),
      );
      commitProject({ ...project, roots });
      setModal(null);

      for (const doc of doomed) {
        if (hasDocument(doc.kind)) {
          await api.deleteDocument(path, doc.id).catch(() => undefined);
        }
      }
      show(`Deleted “${target.title}”.`);
    },
    [project, path, commitProject, show],
  );

  const moveSelected = useCallback(
    (delta: -1 | 1) => {
      if (!project || !selectedId) return;
      commitProject({ ...project, roots: shiftNode(project.roots, selectedId, delta) });
    },
    [project, selectedId, commitProject],
  );

  // --- export ---------------------------------------------------------------

  const exportManuscript = useCallback(
    async (format: "markdown" | "text" | "html") => {
      if (!project || !path) return;
      try {
        await buffer.flush();
        const suggested = await api.suggestedExportName(project, format);
        const destination = await saveDialog({
          defaultPath: suggested,
          title: "Export the manuscript",
        });
        if (typeof destination !== "string") return;
        await api.exportManuscript(path, project, format, destination);
        show(`Exported to ${destination}`);
      } catch (e) {
        onError(errorMessage(e));
      }
    },
    [project, path, buffer, show, onError],
  );

  // --- assistant ------------------------------------------------------------

  // The request the panel is currently listening to. Events from any other
  // request — one that was stopped, or replaced by a newer send — are dropped,
  // so a straggling "done" from an old stream can't end the new one early.
  const activeRequest = useRef<string | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let dead = false;

    const append = (patch: (last: ChatMessage) => ChatMessage) =>
      setChat((prev) => {
        if (prev.length === 0 || prev[prev.length - 1].role !== "assistant") return prev;
        const next = [...prev];
        next[next.length - 1] = patch(next[next.length - 1]);
        return next;
      });
    const current = (requestId: string) => requestId === activeRequest.current;

    void listenToAssistant({
      onDelta: ({ requestId, text }) => {
        if (current(requestId)) append((last) => ({ ...last, content: last.content + text }));
      },
      onReasoning: ({ requestId, text }) => {
        if (current(requestId)) {
          append((last) => ({ ...last, reasoning: (last.reasoning ?? "") + text }));
        }
      },
      onDone: ({ requestId }) => {
        if (!current(requestId)) return;
        activeRequest.current = null;
        setStreaming(false);
      },
      onError: ({ requestId, message }) => {
        if (!current(requestId)) return;
        activeRequest.current = null;
        append((last) => ({ ...last, content: message, error: true }));
        setStreaming(false);
      },
    }).then((off) => (dead ? off() : (unlisten = off)));

    return () => {
      dead = true;
      unlisten?.();
    };
  }, []);

  const buildContext = useCallback(
    (options: SendOptions): string => {
      if (!project) return "";
      const parts = [`Book: ${project.title}${project.author ? ` — by ${project.author}` : ""}`];

      if (editing) {
        parts[0] += `\nOpen document: ${breadcrumb(project.roots, editing.id).join(" › ")}`;
        if (options.useOutline && buffer.outline.trim()) {
          parts.push(`## Outline for this document\n\n${buffer.outline.trim()}`);
        }
        if (options.useSelection && selection.trim()) {
          parts.push(`## The passage they have selected\n\n${selection.trim()}`);
        }
        if (options.useChapter && buffer.body.trim()) {
          parts.push(`## Full text of this document\n\n${buffer.body.trim()}`);
        }
      }
      return parts.join("\n\n");
    },
    [project, editing, buffer.outline, buffer.body, selection],
  );

  const sendToAssistant = useCallback(
    async (text: string, options: SendOptions) => {
      if (!settings || streaming) return;
      const history: ChatMessage[] = [
        ...chat.filter((m) => !m.error),
        { role: "user", content: text },
      ];
      const requestId = String(++requestSeq.current);
      activeRequest.current = requestId;
      setChat([...history, { role: "assistant", content: "" }]);
      setStreaming(true);
      setSideTab("assistant");
      try {
        await api.aiSend({
          requestId,
          provider: settings.provider,
          model: settings.model,
          effort: settings.effort,
          showReasoning: settings.showReasoning,
          context: buildContext(options),
          messages: history,
        });
      } catch {
        // The `ai:error` event already put the message in the transcript.
        if (activeRequest.current === requestId) {
          activeRequest.current = null;
          setStreaming(false);
        }
      }
    },
    [settings, streaming, chat, buildContext],
  );

  // Stop is immediate from the writer's side: the panel returns to idle now,
  // and whatever the old stream still emits is ignored by request id.
  const stopAssistant = useCallback(() => {
    activeRequest.current = null;
    setStreaming(false);
    void api.aiCancel();
  }, []);

  // Remember the last passage highlighted in the editor, so the assistant can
  // still act on it after focus moves to the composer.
  useEffect(() => {
    const track = () => {
      const active = document.activeElement;
      if (!(active instanceof HTMLTextAreaElement) || !active.classList.contains("doc-body")) {
        return;
      }
      setSelection(active.value.slice(active.selectionStart, active.selectionEnd));
    };
    document.addEventListener("selectionchange", track);
    return () => document.removeEventListener("selectionchange", track);
  }, []);

  useEffect(() => setSelection(""), [editing?.id]);

  // --- keyboard -------------------------------------------------------------

  const toggleFocusMode = useCallback(() => {
    setFocusMode((on) => {
      void getCurrentWindow()
        .setFullscreen(!on)
        .catch(() => undefined);
      return !on;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (e.key === "Escape" && focusMode) {
        e.preventDefault();
        toggleFocusMode();
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        toggleFocusMode();
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void buffer.flush();
        return;
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        setModal({ kind: "settings" });
        return;
      }
      if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void chooseAndOpen();
        return;
      }
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        moveSelected(e.key === "ArrowUp" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode, toggleFocusMode, buffer, chooseAndOpen, moveSelected]);

  // --- render ---------------------------------------------------------------

  if (!settings) return <div className="app" />;

  const place = project && editing ? placeOf(project, editing.id) : null;

  return (
    <div
      className="app"
      data-focus={focusMode}
      data-empty={!project}
      style={{
        ["--binder-w" as string]: `${binderWidth.width}px`,
        ["--panel-w" as string]: `${panelWidth.width}px`,
      }}
    >
      <TopBar
        project={project}
        docTitle={node?.title ?? null}
        assistantOpen={sideTab === "assistant"}
        onNewProject={() => void startNewProject()}
        onOpenProject={() => void chooseAndOpen()}
        onSave={() => void buffer.flush()}
        onExport={(format) => void exportManuscript(format)}
        onProjectDetails={() => setModal({ kind: "details" })}
        onSettings={() => setModal({ kind: "settings" })}
        onToggleAssistant={() => setSideTab((t) => (t === "assistant" ? "outline" : "assistant"))}
        onFocusMode={toggleFocusMode}
      />

      {!project || !opened ? (
        <Welcome
          recent={settings.recent}
          onNew={() => void startNewProject()}
          onOpen={() => void chooseAndOpen()}
          onOpenRecent={(p) => void openProjectAt(p)}
          onForget={(p) => {
            void api.forgetProject(p);
            patchSettings({ ...settings, recent: settings.recent.filter((r) => r !== p) });
          }}
        />
      ) : (
        <>
          <Binder
            project={project}
            selectedId={selectedId}
            onSelect={(picked) => setSelectedId(picked.id)}
            onToggle={(id) => {
              const target = findNode(project.roots, id);
              if (target) {
                commitProject({
                  ...project,
                  roots: updateNode(project.roots, id, { expanded: !target.expanded }),
                });
              }
            }}
            onRename={renameNode}
            onAdd={(kind) => void addNode(kind)}
            onImportReference={() => void importReference()}
            onOpenReference={(target) => void openReference(target)}
            onMove={moveSelected}
            onDelete={(target) =>
              !isFixedRoot(target) && setModal({ kind: "confirmDelete", node: target })
            }
            onToggleIncluded={(id) => {
              const target = findNode(project.roots, id);
              if (target) {
                commitProject({
                  ...project,
                  roots: updateNode(project.roots, id, { included: !target.included }),
                });
              }
            }}
          />
          <div
            className="grip"
            data-dragging={binderWidth.dragging}
            style={{ left: binderWidth.width - 3 }}
            onPointerDown={(e) => binderWidth.start(e, 1)}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the binder"
          />

          <Editor
            node={editing}
            body={buffer.body}
            loading={buffer.loading}
            settings={settings}
            place={place}
            onBodyChange={buffer.editBody}
            onTitleChange={(title) => editing && renameNode(editing.id, title)}
          />

          <div
            className="grip"
            data-dragging={panelWidth.dragging}
            style={{ right: panelWidth.width - 3 }}
            onPointerDown={(e) => panelWidth.start(e, -1)}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the side panel"
          />

          <SidePanel tab={sideTab} onTab={setSideTab}>
            {sideTab === "outline" ? (
              <Outline node={editing} text={buffer.outline} onChange={buffer.editOutline} />
            ) : (
              <Assistant
                ready={keyReady}
                providerLabel={PROVIDER_LABELS[settings.provider]}
                modelLabel={settings.model}
                messages={chat}
                streaming={streaming}
                hasDocument={editing !== null}
                selection={selection}
                onSend={(text, options) => void sendToAssistant(text, options)}
                onStop={stopAssistant}
                onClear={() => setChat([])}
                onOpenSettings={() => setModal({ kind: "settings" })}
              />
            )}
          </SidePanel>

          <StatusBar
            node={editing}
            documentWords={countWords(buffer.body)}
            stats={stats}
            saving={buffer.saving}
            savedAt={savedAt}
          />
        </>
      )}

      {modal?.kind === "settings" && (
        <SettingsDialog
          settings={settings}
          onChange={patchSettings}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.kind === "newProject" && (
        <NewProjectDialog
          folder={modal.folder}
          onPickFolder={async () => {
            const folder = await openDialog({ directory: true });
            if (typeof folder === "string") setModal({ kind: "newProject", folder });
          }}
          onCreate={async (name) => {
            adopt(await api.createProject(modal.folder, name));
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.kind === "details" && project && path && (
        <ProjectDetailsDialog
          project={project}
          path={path}
          onSave={(title, author) => {
            commitProject({ ...project, title, author });
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.kind === "confirmDelete" && (
        <ConfirmDialog
          title="Delete"
          body={`You are about to delete “${modal.node.title}”. This action cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => void deleteNode(modal.node)}
          onClose={() => setModal(null)}
        />
      )}

      {toast && (
        <div className="toast" data-tone={toast.tone} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}

/** Where this document sits in the compiled manuscript, for the ribbon. */
function placeOf(project: Project, id: string): { index: number; total: number } | null {
  const docs = manuscriptDocuments(project);
  const index = docs.findIndex((d) => d.id === id);
  return index === -1 ? null : { index, total: docs.length };
}
