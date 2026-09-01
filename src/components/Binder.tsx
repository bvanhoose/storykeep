import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { ContextMenu, Menu, MenuItem, MenuLabel, MenuSeparator } from "./Menu";
import { useContextMenu } from "../hooks";
import { canDrop, locate, visibleRows, type Row } from "../tree";
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
  /** Drop a dragged item at `index` among the children of `parentId`. */
  onMoveTo: (id: string, parentId: string, index: number) => void;
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
  onMoveTo,
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
  const scroller = useRef<HTMLDivElement>(null);
  const rows = visibleRows(project.roots);
  const selected = rows.find((r) => r.node.id === selectedId)?.node ?? null;
  const drag = useBinderDrag(project, rows, scroller, onMoveTo);

  return (
    <nav className="binder" aria-label="Binder">
      <div className="binder-scroll" role="tree" ref={scroller}>
        {rows.map(({ node, depth }) => (
          <BinderRow
            key={node.id}
            node={node}
            depth={depth}
            current={node.id === selectedId}
            renaming={renaming === node.id}
            dragging={drag.dragging === node.id}
            drop={drag.drop?.rowId === node.id ? drag.drop.where : null}
            onPointerDown={(e) => drag.onPointerDown(e, node)}
            onStartRename={() => setRenaming(node.id)}
            onEndRename={(title) => {
              setRenaming(null);
              if (title && title !== node.title) onRename(node.id, title);
            }}
            onActivate={() => {
              // The click that ends a drag is not a click on the row.
              if (drag.consumeClick()) return;
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
              <MenuItem onSelect={() => (close(), onImportReference())}>Reference file…</MenuItem>
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
              <MenuItem onSelect={() => (close(), setRenaming(menu.target.id))}>Rename</MenuItem>
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

// ---------------------------------------------------------------------------
// Drag and drop
// ---------------------------------------------------------------------------

type Where = "before" | "after" | "inside";

interface DropSpot {
  /** The row the indicator is drawn on, and which edge of it. */
  rowId: string;
  where: Where;
  /** What the drop would actually do. */
  parentId: string;
  index: number;
}

/** How far the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 5;
/** Pointer within this many pixels of the binder's edge scrolls it. */
const EDGE = 28;

/**
 * Pointer-driven dragging of binder rows.
 *
 * Plain pointer events rather than HTML5 drag-and-drop: on Windows the
 * webview's native drop handling swallows HTML5 drags unless it is turned
 * off for the whole window, which would also disable dropping files in.
 *
 * The target is found under the pointer on every move. The top and bottom
 * thirds of a row mean "beside it"; the middle means "inside it". Dropping
 * just under an open branch puts the item first among its children, since
 * that is where the line is drawn.
 */
function useBinderDrag(
  project: Project,
  rows: Row[],
  scroller: RefObject<HTMLDivElement | null>,
  onMoveTo: (id: string, parentId: string, index: number) => void,
) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropSpot | null>(null);

  // Everything the window-level listeners need, read through refs so the
  // listeners can be attached once.
  const press = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const spot = useRef<DropSpot | null>(null);
  const latest = useRef({ project, rows, onMoveTo });
  latest.current = { project, rows, onMoveTo };
  const swallowClick = useRef(false);

  const onPointerDown = useCallback((e: ReactPointerEvent, node: BinderNode) => {
    if (e.button !== 0 || isFixedRoot(node)) return;
    press.current = { id: node.id, x: e.clientX, y: e.clientY, moved: false };
  }, []);

  const consumeClick = useCallback(() => {
    const swallowed = swallowClick.current;
    swallowClick.current = false;
    return swallowed;
  }, []);

  useEffect(() => {
    const end = () => {
      press.current = null;
      spot.current = null;
      setDragging(null);
      setDrop(null);
      delete document.body.dataset.dragging;
    };

    const spotAt = (x: number, y: number, draggedId: string): DropSpot | null => {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-row-id]");
      const rowId = el?.dataset.rowId;
      if (!el || !rowId || rowId === draggedId) return null;
      const { project, rows } = latest.current;
      const row = rows.find((r) => r.node.id === rowId);
      if (!row) return null;
      const node = row.node;

      const rect = el.getBoundingClientRect();
      const t = (y - rect.top) / rect.height;
      let where: Where = t < 0.3 ? "before" : t > 0.7 ? "after" : "inside";
      if (where === "inside" && node.kind === "reference") where = t < 0.5 ? "before" : "after";

      let candidate: DropSpot;
      if (where === "inside") {
        candidate = { rowId, where, parentId: node.id, index: node.children.length };
      } else if (where === "after" && node.expanded && node.children.length > 0) {
        candidate = { rowId, where, parentId: node.id, index: 0 };
      } else {
        if (!row.parentId) return null; // beside a root would make a new root
        const at = locate(project.roots, node.id);
        if (!at) return null;
        candidate = {
          rowId,
          where,
          parentId: row.parentId,
          index: where === "before" ? at.index : at.index + 1,
        };
      }
      return canDrop(project, draggedId, candidate.parentId) ? candidate : null;
    };

    const move = (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      if (!p.moved) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
        p.moved = true;
        setDragging(p.id);
        document.body.dataset.dragging = "true";
      }
      const next = spotAt(e.clientX, e.clientY, p.id);
      spot.current = next;
      setDrop(next);

      const pane = scroller.current;
      if (pane) {
        const r = pane.getBoundingClientRect();
        if (e.clientY < r.top + EDGE) pane.scrollTop -= 8;
        else if (e.clientY > r.bottom - EDGE) pane.scrollTop += 8;
      }
    };

    const up = () => {
      const p = press.current;
      if (!p) return;
      if (p.moved) {
        swallowClick.current = true;
        const target = spot.current;
        if (target) latest.current.onMoveTo(p.id, target.parentId, target.index);
      }
      end();
    };

    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && press.current?.moved) end();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", key);
      delete document.body.dataset.dragging;
    };
  }, [scroller]);

  return { dragging, drop, onPointerDown, consumeClick };
}

// ---------------------------------------------------------------------------

interface RowProps {
  node: BinderNode;
  depth: number;
  current: boolean;
  renaming: boolean;
  dragging: boolean;
  drop: Where | null;
  onPointerDown: (e: ReactPointerEvent) => void;
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
  dragging,
  drop,
  onPointerDown,
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
      data-row-id={node.id}
      data-kind={node.kind}
      data-fixed={fixed ? "true" : undefined}
      data-excluded={node.included ? undefined : "true"}
      data-dragging={dragging ? "true" : undefined}
      data-drop={drop ?? undefined}
      aria-current={current}
      style={{ paddingLeft: indent }}
      role="treeitem"
      aria-selected={current}
      tabIndex={-1}
      onPointerDown={onPointerDown}
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
          onPointerDown={(e) => e.stopPropagation()}
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
