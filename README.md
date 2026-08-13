# StoryKeep

A desktop writing environment for long-form fiction. The manuscript, the
research, the characters, and the outline stay in one window; the chapter you're
writing is the only thing that looks loud.

Built from the wireframe in `PXL_20260820_004055578.jpg`, plus a writing
assistant.

---

## What's in the window

```
┌────────────────────────────────────────────────────────────────────────┐
│ StoryKeep   File  Export        The Salt Road · Ch 2   Assistant  Full │
├──────────────┬──────────────────────────────────────┬──────────────────┤
│ MANUSCRIPT   │  Ch 2                                │ OUTLINE│ASSISTANT│
│   Ch 1       │  ──────                            ▕ │                  │
│   Ch 2   ▌   │  The rain came in off the salt      │ — she finds the   │
│   Ch 3       │  flats before dawn…                 │   ledger          │
│ REFERENCES   │                                     │ — Adeline lies    │
│   map.jpg    │                                     │                   │
│ CHARACTERS   │                                     │                   │
│   Adeline    │                                     │                   │
├──────────────┴──────────────────────────────────────┴──────────────────┤
│ 1,204 words here   58,930 in the manuscript   14 chapters      Saved   │
└────────────────────────────────────────────────────────────────────────┘
```

- **Binder** — Manuscript, References, Characters and Notes are permanent:
  they are always there, and they cannot be renamed or deleted. Add your own
  folders inside them freely. Double-click to rename, `Alt ↑`/`Alt ↓` to
  reorder, and right-click any item you made for Rename, Delete, and — on a
  chapter — dropping it from the compile (it goes struck-through and stops
  counting). Deleting always asks first.
- **Editor** — one document at a time, on a page you can retune (typeface, size,
  line spacing, measure). `Ctrl B` / `Ctrl I` wrap the selection in Markdown
  emphasis.
- **Ribbon** — the thin brass line down the page's outer edge is a bookmark: the
  bright segment is the chapter you're in, the bead is where you're scrolled to.
- **Outline** — beats for the open document, saved beside it.
- **Assistant** — see below.
- **Status bar** — words in this document, words in the manuscript, and when the
  last save landed.

### Keyboard

| | |
|---|---|
| `Ctrl S` | Save now (it also autosaves after a pause, and when the window loses focus) |
| `Ctrl O` | Open a project |
| `Ctrl ,` | Settings |
| `Ctrl Shift D` | Distraction-free — hides everything but the page and goes full screen |
| `Esc` | Leave distraction-free |
| `Alt ↑` / `Alt ↓` | Move the selected binder item |
| `Ctrl B` / `Ctrl I` | Bold / italic the selection |

---

## The project format

A project is an ordinary folder. Nothing is locked inside a database, so the
book survives this app.

```
The Salt Road.storykeep/
  project.json        the binder tree, title, author
  content/<id>.md     one Markdown file per chapter, note, or character
  outlines/<id>.md    the outline that sits beside that document
  references/         research files, copied in as-is
```

Back it up, sync it, put it in git, grep it, open it in any editor.

**Export** compiles the manuscript — in binder order, skipping excluded
chapters — to Markdown, plain text, or a self-contained HTML page.

---

## The assistant

A panel beside the editor that can see the chapter you're in, its outline, and
any passage you've selected — and nothing else. The **Chapter**, **Outline** and
**Selection** chips above the composer control exactly what gets sent, per
message.

It runs on **Claude** today (`claude-opus-5` by default). Add an API key in
**Settings → The assistant**; it goes into your operating system's credential
manager, or — if there's no credential service running, which happens on bare
WSL and some Linux setups — into a file in StoryKeep's config folder that's
readable only by your account. The Settings panel tells you which of the two
actually happened rather than assuming.

Requests are made from the Rust process, not the web view, so the key never
enters the page and there's no CORS in the way.

**Other providers.** ChatGPT, Gemini, and a local model are listed in Settings
and marked "not wired up yet" — the provider abstraction, key storage, model
field, and chat panel are all provider-agnostic already. Adding one is a new
match arm in `src-tauri/src/ai.rs::stream_chat` plus a request builder; nothing
outside that file needs to change.

---

## Running it

### Prerequisites

- [Node.js](https://nodejs.org) 20+
- [Rust](https://rustup.rs) (stable)

**Windows** also needs the *Desktop development with C++* workload from the
Visual Studio Build Tools, and WebView2 (already present on Windows 11 and
up-to-date Windows 10).

**Linux** needs the GTK/WebKit development packages. On Fedora:

```sh
sudo dnf install webkit2gtk4.1-devel openssl-devel gtk3-devel libsoup3-devel \
                 librsvg2-devel curl wget file gcc gcc-c++ make
```

On Debian/Ubuntu the equivalents are `libwebkit2gtk-4.1-dev`,
`libgtk-3-dev`, `libsoup-3.0-dev`, `librsvg2-dev`, `build-essential`.

### Develop

```sh
npm install
npm run app          # tauri dev — hot-reloads the UI, rebuilds Rust on change
```

**Under WSL** the app detects WSLg and turns off WebKit's DMA-BUF renderer
automatically — WSLg's virtual GPU makes it open blank or crash on launch
otherwise. Set `WEBKIT_DISABLE_DMABUF_RENDERER=0` yourself to override the
workaround if your setup renders fine without it.

### Build installers

```sh
npm run app:build
```

Installers land in `src-tauri/target/release/bundle/`:

- **Windows** — `.msi` and an NSIS `.exe`
- **Linux** — `.deb`, `.rpm`, and an AppImage

Tauri does not cross-compile: run the build on the platform you want installers
for. Building from WSL produces Linux artifacts only.

To get a Windows installer, copy the source across and build it there:

```sh
./scripts/sync-to-windows.sh          # → D:\Projects\storykeep
./scripts/sync-to-windows.sh -n       # preview without writing
```

The sync leaves out `node_modules`, `src-tauri/target`, `dist` and
`src-tauri/gen` — they hold Linux binaries that would break a Windows build —
and it doesn't touch whatever npm and cargo have already put on the Windows
side, so re-syncing after an edit is quick. Then, from a Windows terminal in
`D:\Projects\storykeep`:

```bat
scripts\windows-build.cmd
```

### Tests

```sh
cd src-tauri && cargo test    # path safety, word counting, SSE parsing, export
npx tsc --noEmit              # frontend types
```

---

## Layout of the source

```
src/                    React frontend
  App.tsx               state, project lifecycle, keyboard, assistant wiring
  api.ts                the only place that calls into Rust
  tree.ts               pure binder-tree operations
  hooks.ts              autosave buffer, toasts, draggable columns
  types.ts              shared shapes; countWords mirrors the Rust version
  styles.css            the whole design system
  components/           TopBar, Binder, Editor, SidePanel, Assistant, dialogs…

src-tauri/src/          Rust backend
  lib.rs                commands and app state
  project.rs            on-disk format, path safety, word counting
  ai.rs                 provider layer + streaming Anthropic client
  secrets.rs            keychain with a permissioned-file fallback
  export.rs             compiling to Markdown / text / HTML
  settings.rs           preferences and the recent-projects list
```

---

## Known gaps

- **Reordering is buttons, not drag-and-drop.** `Alt ↑`/`Alt ↓` and the binder
  footer arrows move an item among its siblings; there's no dragging between
  folders yet.
- **No undo across documents.** The editor has the usual per-field undo, but
  deleting a binder item is not undoable from inside the app (the dialog says
  so). The files are on disk, so a backup or a git history covers it.
- **Word counts are computed twice** — in TypeScript for the live "words here"
  figure and in Rust for the manuscript total. The two implementations are kept
  in step deliberately; there are tests on the Rust side and a comment on both.
- **Only Claude is wired up.** See the assistant section above.
