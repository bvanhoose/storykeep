import { useEffect, useRef, useState, type MouseEvent } from "react";
import { ContextMenu, Menu, MenuItem, MenuLabel, MenuSeparator } from "./Menu";
import { useContextMenu } from "../hooks";
import { visibleRows } from "../tree";
import { isFixedRoot } from "../types";
import type { BinderNode, NodeKind, Project, TrashedItem } from "../types";

interface BinderProps {
  project: Project;
  selectedId: string | null;
  onSelect: (node: BinderNode) => void;
  onToggle: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onAdd: (kind: NodeKind) => void;
  onImportReference: () => void;
  onOpenReference: (node: BinderNode) => void;
  onMove: (delta: -1 | 1) => void;
  /** Moves the item to the trash. Reversible, so it doesn't ask. */
  onDelete: (node: BinderNode) => void;
  onToggleIncluded: (id: string) => void;
  onRestore: (id: string) => void;
  /** Removes for good. The caller confirms first. */
  onPurge: (items: TrashedItem[]) => void;
}

export function Binder({
  project,
  selectedId,
  onSelect,
  onToggle,
  onRename,
  onAdd,
  onImportReference,
  onOpenReference,
  onMove,
  onDelete,
  onToggleIncluded,
  onRestore,
  onPurge,
}: BinderProps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const { menu, openMenu, closeMenu } = useContextMenu<BinderNode>();
  // `null` is the Trash heading itself, whose only action is Empty.
  const trashMenu = useContextMenu<TrashedItem | null>();
  const rows = visibleRows(project.roots);
  const selected = rows.find((r) => r.node.id === selectedId)?.node ?? null;

  return (
    <nav className="binder" aria-label="Binder">
      <div className="binder-scroll" role="tree">
        {rows.map(({ node, depth }) => (
          <BinderRow
            key={node.id}
            node={node}
            depth={depth}
            current={node.id === selectedId}
            renaming={renaming === node.id}
            onStartRename={() => setRenaming(node.id)}
            onEndRename={(title) => {
              setRenaming(null);
              if (title && title !== node.title) onRename(node.id, title);
            }}
            onActivate={() => {
              if (node.kind === "reference") onOpenReference(node);
              else if (node.kind === "folder") onToggle(node.id);
              onSelect(node);
            }}
            onToggle={() => onToggle(node.id)}
            onContextMenu={(e) => {
              // Select first, so the row the menu acts on is also the row the
              // rest of the window is showing.
              onSelect(node);
              openMenu(e, node);
            }}
          />
        ))}

        {project.trash.length > 0 && (
          <div className="trash">
            <div
              className="row"
              data-kind="folder"
              role="treeitem"
              aria-expanded={trashOpen}
              tabIndex={-1}
              style={{ paddingLeft: 10 }}
              onClick={() => setTrashOpen((v) => !v)}
              onContextMenu={(e) => {
                e.preventDefault();
                trashMenu.openMenu(e, null);
              }}
            >
              <span className="row-twist" data-open={trashOpen}>
                ▶
              </span>
              <span className="row-title">Trash</span>
              <span className="row-tag">{project.trash.length}</span>
            </div>
            {trashOpen &&
              project.trash.map((item) => (
                <div
                  key={item.node.id}
                  className="row"
                  data-kind={item.node.kind}
                  data-trashed="true"
                  role="treeitem"
                  tabIndex={-1}
                  style={{ paddingLeft: 23 }}
                  title="Right-click to restore"
                  onDoubleClick={() => onRestore(item.node.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    trashMenu.openMenu(e, item);
                  }}
                >
                  <span className="row-twist" />
                  <span className="row-title">{item.node.title}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="binder-foot">
        <Menu label="Add" placement="up">
          {(close) => (
            <>
              <MenuLabel>Add to the binder</MenuLabel>
              <MenuItem onSelect={() => (close(), onAdd("chapter"))}>Chapter</MenuItem>
              <MenuItem onSelect={() => (close(), onAdd("folder"))}>Folder</MenuItem>
              <MenuItem onSelect={() => (close(), onAdd("character"))}>Character</MenuItem>
              <MenuItem onSelect={() => (close(), onAdd("note"))}>Note</MenuItem>
              <MenuSeparator />
              <MenuItem onSelect={() => (close(), onImportReference())}>
                Reference file…
              </MenuItem>
            </>
          )}
        </Menu>
        <span className="stat-spacer" />
        <button
          type="button"
          className="icon-btn"
          onClick={() => onMove(-1)}
          disabled={!selected}
          title="Move up (Alt ↑)"
          aria-label="Move up"
        >
          ↑
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => onMove(1)}
          disabled={!selected}
          title="Move down (Alt ↓)"
          aria-label="Move down"
        >
          ↓
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => selected && onDelete(selected)}
          disabled={!selected || isFixedRoot(selected)}
          title={selected && isFixedRoot(selected) ? "This folder is permanent" : "Move to trash"}
          aria-label="Move to trash"
        >
          ×
        </button>
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={closeMenu}>
          {(close) => (
            <>
              <MenuLabel>{menu.target.title}</MenuLabel>
              <MenuItem onSelect={() => (close(), setRenaming(menu.target.id))}>
                Rename
              </MenuItem>
              {menu.target.kind === "chapter" && (
                <MenuItem onSelect={() => (close(), onToggleIncluded(menu.target.id))}>
                  {menu.target.included ? "Exclude from compile" : "Include in compile"}
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem danger onSelect={() => (close(), onDelete(menu.target))}>
                Move to trash
              </MenuItem>
            </>
          )}
        </ContextMenu>
      )}

      {trashMenu.menu && (
        <ContextMenu x={trashMenu.menu.x} y={trashMenu.menu.y} onClose={trashMenu.closeMenu}>
          {(close) => {
            const item = trashMenu.menu?.target ?? null;
            return item ? (
              <>
                <MenuLabel>{item.node.title}</MenuLabel>
                <MenuItem onSelect={() => (close(), onRestore(item.node.id))}>Restore</MenuItem>
                <MenuSeparator />
                <MenuItem danger onSelect={() => (close(), onPurge([item]))}>
                  Delete for good…
                </MenuItem>
              </>
            ) : (
              <>
                <MenuLabel>Trash</MenuLabel>
                <MenuItem danger onSelect={() => (close(), onPurge(project.trash))}>
                  Empty the trash…
                </MenuItem>
              </>
            );
          }}
        </ContextMenu>
      )}
    </nav>
  );
}

interface RowProps {
  node: BinderNode;
  depth: number;
  current: boolean;
  renaming: boolean;
  onStartRename: () => void;
  onEndRename: (title: string) => void;
  onActivate: () => void;
  onToggle: () => void;
  onContextMenu: (e: MouseEvent) => void;
}

function BinderRow({
  node,
  depth,
  current,
  renaming,
  onStartRename,
  onEndRename,
  onActivate,
  onContextMenu,
  onToggle,
}: RowProps) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) {
      input.current?.focus();
      input.current?.select();
    }
  }, [renaming]);

  const indent = 10 + depth * 13;
  const branch = node.children.length > 0 || node.kind === "folder";
  const fixed = isFixedRoot(node);
  const tag = node.kind === "reference" ? extensionOf(node) : null;

  return (
    <div
      className="row"
      data-kind={node.kind}
      data-fixed={fixed ? "true" : undefined}
      data-excluded={node.included ? undefined : "true"}
      aria-current={current}
      style={{ paddingLeft: indent }}
      role="treeitem"
      aria-selected={current}
      tabIndex={-1}
      onClick={onActivate}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!fixed) onStartRename();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        // The four permanent roots have nothing on the menu worth offering.
        if (!fixed) onContextMenu(e);
      }}
    >
      <span
        className="row-twist"
        data-open={branch && node.expanded}
        onClick={(e) => {
          if (!branch) return;
          e.stopPropagation();
          onToggle();
        }}
      >
        {branch ? "▶" : ""}
      </span>

      {renaming ? (
        <input
          ref={input}
          className="row-input"
          defaultValue={node.title}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => onEndRename(e.currentTarget.value.trim())}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") onEndRename("");
          }}
        />
      ) : (
        <span className="row-title">{node.title}</span>
      )}

      {tag && !renaming && <span className="row-tag">{tag}</span>}
    </div>
  );
}

function extensionOf(node: BinderNode): string {
  if (node.url) return "link";
  const name = node.file ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).slice(0, 4) : "file";
}
