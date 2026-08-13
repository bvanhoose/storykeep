import { Menu, MenuItem, MenuLabel, MenuSeparator } from "./Menu";
import type { Project } from "../types";

const MOD = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl";

interface TopBarProps {
  project: Project | null;
  docTitle: string | null;
  assistantOpen: boolean;
  onNewProject: () => void;
  onOpenProject: () => void;
  onSave: () => void;
  onExport: (format: "markdown" | "text" | "html") => void;
  onProjectDetails: () => void;
  onSettings: () => void;
  onToggleAssistant: () => void;
  onFocusMode: () => void;
}

export function TopBar({
  project,
  docTitle,
  assistantOpen,
  onNewProject,
  onOpenProject,
  onSave,
  onExport,
  onProjectDetails,
  onSettings,
  onToggleAssistant,
  onFocusMode,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        Story<span>Keep</span>
      </div>

      <Menu label="File">
        {(close) => (
          <>
            <MenuItem onSelect={() => (close(), onNewProject())}>New manuscript…</MenuItem>
            <MenuItem onSelect={() => (close(), onOpenProject())} shortcut={`${MOD} O`}>
              Open project…
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              onSelect={() => (close(), onSave())}
              disabled={!project}
              shortcut={`${MOD} S`}
            >
              Save now
            </MenuItem>
            <MenuItem onSelect={() => (close(), onProjectDetails())} disabled={!project}>
              Project details…
            </MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => (close(), onSettings())} shortcut={`${MOD} ,`}>
              Settings…
            </MenuItem>
          </>
        )}
      </Menu>

      <Menu label="Export">
        {(close) => (
          <>
            <MenuLabel>Compile the manuscript to</MenuLabel>
            <MenuItem onSelect={() => (close(), onExport("markdown"))} disabled={!project}>
              Markdown (.md)
            </MenuItem>
            <MenuItem onSelect={() => (close(), onExport("text"))} disabled={!project}>
              Plain text (.txt)
            </MenuItem>
            <MenuItem onSelect={() => (close(), onExport("html"))} disabled={!project}>
              Web page (.html)
            </MenuItem>
          </>
        )}
      </Menu>

      <p className="tb-title">
        {project ? (
          <>
            <b>{project.title}</b>
            {docTitle ? ` · ${docTitle}` : ""}
          </>
        ) : (
          "No project open"
        )}
      </p>

      <button
        type="button"
        className="tb"
        aria-pressed={assistantOpen}
        onClick={onToggleAssistant}
        disabled={!project}
        title="Open the writing assistant"
      >
        Assistant
      </button>
      <button
        type="button"
        className="tb"
        onClick={onFocusMode}
        disabled={!project}
        title={`Distraction-free (${MOD} ⇧ D)`}
      >
        Full screen
      </button>
    </header>
  );
}
