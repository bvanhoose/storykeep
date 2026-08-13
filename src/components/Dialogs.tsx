import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, errorMessage } from "../api";
import {
  PROVIDER_LABELS,
  type Effort,
  type EditorFont,
  type KeyStatus,
  type Project,
  type Provider,
  type Settings,
  type Theme,
} from "../types";

/** Shared modal shell: traps Escape, focuses itself, dims the app behind. */
function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panel}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const MODEL_SUGGESTIONS: Record<Provider, string[]> = {
  anthropic: ["claude-opus-5", "claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5"],
  openai: ["gpt-5"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
  local: ["local"],
};

const EFFORTS: { value: Effort; label: string }[] = [
  { value: "low", label: "Low — quickest, for small asks" },
  { value: "medium", label: "Medium — everyday balance" },
  { value: "high", label: "High — thinks harder, slower" },
  { value: "xhigh", label: "Very high" },
  { value: "max", label: "Maximum — slowest, most thorough" },
];

interface SettingsDialogProps {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onClose: () => void;
}

export function SettingsDialog({ settings, onChange, onClose }: SettingsDialogProps) {
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider = settings.provider;
  const providerLabel = PROVIDER_LABELS[provider];

  useEffect(() => {
    setKeyDraft("");
    api.keyStatus(provider).then(setKeyStatus).catch(() => setKeyStatus(null));
  }, [provider]);

  const patch = (change: Partial<Settings>) => onChange({ ...settings, ...change });

  const saveKey = async () => {
    setBusy(true);
    setError(null);
    try {
      setKeyStatus(await api.setApiKey(provider, keyDraft));
      setKeyDraft("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const removeKey = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.clearApiKey(provider);
      setKeyStatus({ configured: false, backend: null });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Settings" onClose={onClose}>
      {error && <p className="dialog-error">{error}</p>}

      <div className="menu-label" style={{ padding: "0 0 8px" }}>
        The page
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="set-theme">Theme</label>
          <select
            id="set-theme"
            value={settings.theme}
            onChange={(e) => patch({ theme: e.currentTarget.value as Theme })}
          >
            <option value="system">Match the system</option>
            <option value="light">Linen</option>
            <option value="dark">Nightbound</option>
            <option value="sepia">Sepia</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="set-font">Typeface</label>
          <select
            id="set-font"
            value={settings.editorFont}
            onChange={(e) => patch({ editorFont: e.currentTarget.value as EditorFont })}
          >
            <option value="serif">Serif</option>
            <option value="sans">Sans</option>
            <option value="mono">Monospace</option>
          </select>
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="set-size">Size</label>
          <input
            id="set-size"
            type="number"
            min={12}
            max={32}
            value={settings.editorFontSize}
            onChange={(e) => patch({ editorFontSize: clampNumber(e.currentTarget.value, 12, 32, 18) })}
          />
        </div>
        <div className="field">
          <label htmlFor="set-leading">Line spacing</label>
          <input
            id="set-leading"
            type="number"
            min={1.2}
            max={2.4}
            step={0.05}
            value={settings.editorLineHeight}
            onChange={(e) =>
              patch({ editorLineHeight: clampNumber(e.currentTarget.value, 1.2, 2.4, 1.7) })
            }
          />
        </div>
        <div className="field">
          <label htmlFor="set-measure">Line width</label>
          <input
            id="set-measure"
            type="number"
            min={40}
            max={110}
            value={settings.editorMeasure}
            onChange={(e) => patch({ editorMeasure: clampNumber(e.currentTarget.value, 40, 110, 68) })}
          />
        </div>
      </div>

      <label className="check" style={{ marginBottom: 6 }}>
        <input
          type="checkbox"
          checked={settings.spellCheck}
          onChange={(e) => patch({ spellCheck: e.currentTarget.checked })}
        />
        Check spelling while writing
      </label>

      <div className="menu-label" style={{ padding: "18px 0 8px" }}>
        The assistant
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="set-provider">Service</label>
          <select
            id="set-provider"
            value={provider}
            onChange={(e) => {
              const next = e.currentTarget.value as Provider;
              patch({ provider: next, model: MODEL_SUGGESTIONS[next][0] });
            }}
          >
            {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
                {p === "anthropic" ? "" : " (not wired up yet)"}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="set-model">Model</label>
          <input
            id="set-model"
            type="text"
            list="model-options"
            value={settings.model}
            spellCheck={false}
            onChange={(e) => patch({ model: e.currentTarget.value })}
          />
          <datalist id="model-options">
            {MODEL_SUGGESTIONS[provider].map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="field">
        <label htmlFor="set-effort">How hard it thinks</label>
        <select
          id="set-effort"
          value={settings.effort}
          onChange={(e) => patch({ effort: e.currentTarget.value as Effort })}
        >
          {EFFORTS.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
      </div>

      <label className="check" style={{ marginBottom: 14 }}>
        <input
          type="checkbox"
          checked={settings.showReasoning}
          onChange={(e) => patch({ showReasoning: e.currentTarget.checked })}
        />
        Show a summary of its reasoning
      </label>

      <div className="field">
        <label htmlFor="set-key">{providerLabel} API key</label>
        <div className="field-row">
          <input
            id="set-key"
            type="password"
            value={keyDraft}
            spellCheck={false}
            autoComplete="off"
            placeholder={keyStatus?.configured ? "A key is saved — type a new one to replace it" : "Paste the key"}
            onChange={(e) => setKeyDraft(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && keyDraft.trim() && void saveKey()}
          />
          <button
            type="button"
            className="btn"
            style={{ flex: "none" }}
            disabled={busy || keyDraft.trim().length === 0}
            onClick={() => void saveKey()}
          >
            Save key
          </button>
        </div>
        <p className="field-note">
          {keyStatus?.configured ? (
            <>
              Saved in{" "}
              {keyStatus.backend === "osKeychain"
                ? "your operating system's credential manager"
                : "a file in StoryKeep's config folder, readable only by your account"}
              .{" "}
              <button
                type="button"
                className="turn-copy"
                style={{ margin: 0 }}
                disabled={busy}
                onClick={() => void removeKey()}
              >
                Remove it
              </button>
            </>
          ) : (
            <>No key saved. The assistant stays disabled until you add one.</>
          )}
        </p>
      </div>

      <div className="dialog-actions">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

interface NewProjectDialogProps {
  folder: string;
  onPickFolder: () => void;
  onCreate: (name: string) => Promise<void>;
  onClose: () => void;
}

export function NewProjectDialog({
  folder,
  onPickFolder,
  onCreate,
  onClose,
}: NewProjectDialogProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim() || !folder) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(name.trim());
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Dialog title="New manuscript" onClose={onClose}>
      {error && <p className="dialog-error">{error}</p>}

      <div className="field">
        <label htmlFor="new-name">Title</label>
        <input
          id="new-name"
          type="text"
          value={name}
          autoFocus
          placeholder="The Salt Road"
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
        />
      </div>

      <div className="field">
        <label>Keep it in</label>
        <div className="field-row">
          <input type="text" value={folder} readOnly placeholder="Choose a folder" />
          <button type="button" className="btn" style={{ flex: "none" }} onClick={onPickFolder}>
            Choose…
          </button>
        </div>
        <p className="field-note">
          {folder && name.trim()
            ? `Creates ${name.trim()}.storykeep — a folder you can back up, sync, or open in any editor.`
            : "StoryKeep makes one folder here that holds the whole project."}
        </p>
      </div>

      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !name.trim() || !folder}
          onClick={() => void submit()}
        >
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

interface ProjectDetailsProps {
  project: Project;
  path: string;
  onSave: (title: string, author: string) => void;
  onClose: () => void;
}

export function ProjectDetailsDialog({ project, path, onSave, onClose }: ProjectDetailsProps) {
  const [title, setTitle] = useState(project.title);
  const [author, setAuthor] = useState(project.author);

  return (
    <Dialog title="Project details" onClose={onClose}>
      <div className="field">
        <label htmlFor="pd-title">Title</label>
        <input
          id="pd-title"
          type="text"
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="pd-author">Author</label>
        <input
          id="pd-author"
          type="text"
          value={author}
          placeholder="Shown on the title page when you export"
          onChange={(e) => setAuthor(e.currentTarget.value)}
        />
      </div>
      <div className="field">
        <label>Folder</label>
        <p className="field-note" style={{ wordBreak: "break-all" }}>
          {path}
        </p>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onSave(title.trim() || project.title, author.trim())}
        >
          Save
        </button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Dialog title={title} onClose={onClose}>
      <p style={{ margin: "0 0 4px", lineHeight: 1.6 }}>{body}</p>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose} autoFocus>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

function clampNumber(raw: string, min: number, max: number, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}
