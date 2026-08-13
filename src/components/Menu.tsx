import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

interface MenuProps {
  label: string;
  /** Which way the panel opens. "up" is for a menu that sits at the foot of a pane. */
  placement?: "down" | "up";
  children: (close: () => void) => ReactNode;
}

/** A dropdown that closes on outside click, Escape, or item choice. */
export function Menu({ label, placement = "down", children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        type="button"
        className="tb"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && (
        <div className={`menu menu-${placement}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

interface ContextMenuProps {
  /** Where the pointer was, in viewport coordinates. */
  x: number;
  y: number;
  onClose: () => void;
  children: (close: () => void) => ReactNode;
}

/**
 * A menu pinned to the pointer.
 *
 * It is measured after mount and then flipped against whichever viewport edge
 * it would have overflowed, so a row near the bottom of the binder still shows
 * its items instead of running off under the taskbar.
 */
export function ContextMenu({ x, y, onClose, children }: ContextMenuProps) {
  const panel = useRef<HTMLDivElement>(null);
  // Hidden for the first paint: the panel has to exist to be measured, and we
  // would rather not show it at the unflipped spot for a frame.
  const [at, setAt] = useState({ left: x, top: y, placed: false });

  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const pad = 6;
    const { width, height } = el.getBoundingClientRect();
    const fitsBelow = y + height + pad <= window.innerHeight;
    setAt({
      left: Math.max(pad, Math.min(x, window.innerWidth - width - pad)),
      top: fitsBelow ? y : Math.max(pad, y - height),
      placed: true,
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // The panel is pinned to the viewport, so anything that moves the row out
    // from under it should dismiss rather than leave it stranded.
    document.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={panel}
      className="menu menu-at-pointer"
      role="menu"
      style={{ left: at.left, top: at.top, visibility: at.placed ? "visible" : "hidden" }}
    >
      {children(onClose)}
    </div>
  );
}

interface ItemProps {
  onSelect: () => void;
  disabled?: boolean;
  shortcut?: string;
  /** Tints the item on hover. For actions that throw work away. */
  danger?: boolean;
  children: ReactNode;
}

export function MenuItem({ onSelect, disabled, shortcut, danger, children }: ItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className="menu-item"
      data-danger={danger ? "true" : undefined}
      disabled={disabled}
      onClick={onSelect}
    >
      <span>{children}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="menu-sep" role="separator" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="menu-label">{children}</div>;
}
