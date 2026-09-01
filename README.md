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
  folders inside them freely. Drag rows to reorder them or move them into
  another folder (a chapter stays inside the manuscript, so it can't quietly
  leave the compile); `Alt ↑`/`Alt ↓` do the same from the keyboard.
  Double-click to rename, and right-click any item you made for Rename, Move
  to trash, and — on a chapter — dropping it from the compile (it goes
  struck-through and stops counting).
- **Trash** — deleting moves an item to a Trash section at the foot of the
  binder and offers Undo for a few seconds; its files stay on disk until you
  right-click and delete it for good, or empty the trash. Those two are the
  only things that ask first.
- **Editor** — one document at a time, on a page you can retune (typeface, size,
  line spacing, measure). `Ctrl B` / `Ctrl I` wrap the selection in Markdown
  emphasis.
- **Ribbon** — the thin brass line down the page's outer edge is a bookmark: the
  bright segment is the chapter you're in, the bead is where you're scrolled to.
- **Outline** — beats for the open document, saved beside it.
- **Search** — `Ctrl Shift F` searches every title, document and outline in
  the project. Results are grouped by document; clicking one opens the
  document with the match selected and scrolled into view.
- **History** — dated snapshots of the open document. `Ctrl Shift S` takes
  one; the first edit each day also takes one of the text as it stood, so
  there is always a "this morning" to go back to. Pick a snapshot to see
  what has changed since, then restore it — the text being replaced is
  snapshotted first, so a restore can itself be undone.
- **Assistant** — see below.
- **Status bar** — words in this document, words in the manuscript, words
  added today, and when the last save landed. Set a manuscript length and a
  daily goal in **File → Project details** and thin meters appear beside the
  numbers, along with a strip of the last fortnight in the dialog.

### Keyboard

| | |
|---|---|
| `Ctrl S` | Save now (it also autosaves after a pause, and when the window loses focus) |
| `Ctrl O` | Open a project |
| `Ctrl ,` | Settings |
| `Ctrl Shift F` | Search the whole project |
| `Ctrl Shift S` | Take a snapshot of the open document |
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
  project.json        the binder tree, title, author, targets, and the trash
  content/<id>.md     one Markdown file per chapter, note, or character
  outlines/<id>.md    the outline that sits beside that document
  references/         research files, copied in as-is
  snapshots/<id>/     dated copies of a document, one Markdown file each
  progress.json       manuscript word count at the start and end of each day
```

A trashed document's files stay where they are; only `project.json` stops
pointing at them, so nothing is lost until you empty the trash.

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

On Windows, `build.cmd` at the repo root does the same and can be
double-clicked; it holds the window open at the end and offers to launch the
fresh exe. From a terminal, `build dev` starts the hot-reloading dev build
instead and `build check` runs the lint and test pipeline without building.

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
side, so re-syncing after an edit is quick. Then double-click `build.cmd` in
`D:\Projects\storykeep`, or from a terminal there:

```bat
build
```

### Tests

```sh
cd src-tauri && cargo test    # path safety, word counting, SSE parsing, export,
                              # search, snapshots, progress, model features
npm test                      # tree operations, the diff, word counting
npx tsc --noEmit              # frontend types
```

Word counting is implemented on both sides on purpose; both test suites run
the same cases from `fixtures/word-count.json`, so they can't drift apart
quietly.

### Shared types

Every shape that crosses between Rust and the window — the project, binder
nodes, settings, search hits, assistant events — is defined once in Rust and
generated into `src/generated/` by [ts-rs](https://github.com/Aleph-Alpha/ts-rs).
`src/types.ts` re-exports them. After changing a `#[ts(export)]` type:

```sh
npm run types                 # cargo test export_bindings, then commit src/generated
```

The generated files are committed so the frontend builds without a Rust
toolchain.

---

## Where state lives

The window owns the project. The binder tree lives in React state between
saves; the Rust side holds nothing about the open book, only app-wide things
like the config folder and the assistant request in flight. Commands that
need the tree — the word count, search, export — are handed it as an
argument, so there is one copy of the tree and no way for the two sides to
disagree about it. That means the tree crosses the IPC boundary on those
calls, which is a few kilobytes of JSON next to the chapter files they then
read. Document text is the exception: it is read and written by id and never
held on both sides.

## Layout of the source

```
src/                    React frontend
  App.tsx               state, project lifecycle, keyboard, assistant wiring
  api.ts                the only place that calls into Rust
  tree.ts               pure binder-tree operations, including move and drop rules
  diff.ts               line diff for the History tab
  hooks.ts              autosave buffer, toasts, draggable columns
  types.ts              re-exports the generated shapes; countWords mirrors Rust
  generated/            TypeScript for every Rust type on the IPC boundary (ts-rs)
  styles.css            the whole design system
  components/           TopBar, Binder, Editor, SidePanel, Search, History,
                        Assistant, dialogs…

src-tauri/src/          Rust backend
  lib.rs                commands and app state
  project.rs            on-disk format, path safety, word counting, trash purge
  search.rs             project-wide text search
  snapshots.rs          dated copies of a document
  progress.rs           the daily word-count ledger
  ai.rs                 provider layer + streaming Anthropic client
  secrets.rs            keychain with a permissioned-file fallback
  export.rs             compiling to Markdown / text / HTML
  settings.rs           preferences and the recent-projects list
```

---

## Known gaps

- **Snapshots are per document.** There is no project-wide history; a
  reorganisation of the binder isn't captured. The folder is plain files, so
  git covers that if you want it.
- **The assistant renders plain text.** Markdown in its replies shows as
  written, asterisks and all.
- **Word counts are computed twice** — in TypeScript for the live "words here"
  figure and in Rust for the manuscript total. The two implementations are kept
  in step deliberately; there are tests on the Rust side and a comment on both.
- **Only Claude is wired up.** See the assistant section above.
