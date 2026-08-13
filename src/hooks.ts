import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "./api";

/** Milliseconds of quiet before an edit is written to disk. */
const SAVE_DELAY = 700;

interface Pending {
  path: string;
  id: string;
  body?: string;
  outline?: string;
}

export interface DocumentBuffer {
  body: string;
  outline: string;
  loading: boolean;
  saving: boolean;
  editBody: (value: string) => void;
  editOutline: (value: string) => void;
  /** Write anything outstanding right now. Safe to call when nothing is dirty. */
  flush: () => Promise<void>;
}

/**
 * Holds the open document's text and writes it back after a pause in typing.
 *
 * Switching documents flushes the previous one first, so a fast click through
 * the binder can't strand an unsaved edit.
 */
export function useDocumentBuffer(
  path: string | null,
  docId: string | null,
  onSaved: () => void,
  onError: (message: string) => void,
): DocumentBuffer {
  const [body, setBody] = useState("");
  const [outline, setOutline] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const pending = useRef<Pending | null>(null);
  const timer = useRef<number | undefined>(undefined);
  // Kept in refs so `flush` can stay referentially stable across renders.
  const saved = useRef(onSaved);
  const failed = useRef(onError);
  saved.current = onSaved;
  failed.current = onError;

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const outstanding = pending.current;
    pending.current = null;
    if (!outstanding) {
      setSaving(false);
      return;
    }
    try {
      if (outstanding.body !== undefined) {
        await api.writeDocument(outstanding.path, outstanding.id, outstanding.body);
      }
      if (outstanding.outline !== undefined) {
        await api.writeOutline(outstanding.path, outstanding.id, outstanding.outline);
      }
      saved.current();
    } catch (e) {
      failed.current(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }, []);

  const queue = useCallback(
    (change: Partial<Pick<Pending, "body" | "outline">>) => {
      if (!path || !docId) return;
      const current = pending.current;
      pending.current =
        current && current.id === docId && current.path === path
          ? { ...current, ...change }
          : { path, id: docId, ...change };
      setSaving(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY);
    },
    [path, docId, flush],
  );

  const editBody = useCallback(
    (value: string) => {
      setBody(value);
      queue({ body: value });
    },
    [queue],
  );

  const editOutline = useCallback(
    (value: string) => {
      setOutline(value);
      queue({ outline: value });
    },
    [queue],
  );

  useEffect(() => {
    void flush(); // whatever was open before this change
    if (!path || !docId) {
      setBody("");
      setOutline("");
      return;
    }
    let stale = false;
    setLoading(true);
    Promise.all([api.readDocument(path, docId), api.readOutline(path, docId)])
      .then(([nextBody, nextOutline]) => {
        if (stale) return;
        setBody(nextBody);
        setOutline(nextOutline);
      })
      .catch((e) => !stale && failed.current(errorMessage(e)))
      .finally(() => !stale && setLoading(false));
    return () => {
      stale = true;
    };
  }, [path, docId, flush]);

  // Leaving the window is a good moment to commit; it covers alt-tabbing away
  // mid-sentence and closing the app from the title bar.
  useEffect(() => {
    const commit = () => void flush();
    window.addEventListener("blur", commit);
    document.addEventListener("visibilitychange", commit);
    return () => {
      window.removeEventListener("blur", commit);
      document.removeEventListener("visibilitychange", commit);
    };
  }, [flush]);

  return { body, outline, loading, saving, editBody, editOutline, flush };
}

/** A transient message at the bottom of the window. */
/** Tracks the pointer position for a `ContextMenu` over a list of rows. */
export function useContextMenu<T>() {
  const [menu, setMenu] = useState<{ target: T; x: number; y: number } | null>(null);
  const openMenu = useCallback((e: { clientX: number; clientY: number }, target: T) => {
    setMenu({ target, x: e.clientX, y: e.clientY });
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);
  return { menu, openMenu, closeMenu };
}

export function useToast() {
  const [toast, setToast] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((text: string, tone: "info" | "error" = "info") => {
    setToast({ text, tone });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), tone === "error" ? 7000 : 3200);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { toast, show, dismiss: () => setToast(null) };
}

/** A width the user can drag, remembered between sessions. */
export function useDraggableWidth(key: string, initial: number, min: number, max: number) {
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(key));
    return Number.isFinite(stored) && stored >= min && stored <= max ? stored : initial;
  });
  const [dragging, setDragging] = useState(false);

  const start = useCallback(
    (event: React.PointerEvent, direction: 1 | -1) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;
      setDragging(true);

      const move = (e: PointerEvent) => {
        const next = Math.min(Math.max(startWidth + (e.clientX - startX) * direction, min), max);
        setWidth(next);
      };
      const end = () => {
        setDragging(false);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
    },
    [width, min, max],
  );

  useEffect(() => {
    localStorage.setItem(key, String(width));
  }, [key, width]);

  return { width, dragging, start };
}
