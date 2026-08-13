/** Pure helpers for the binder tree. Every function returns new nodes rather
 *  than mutating, so React sees the change and undo stays possible later. */
import type { BinderNode, NodeRole, Project } from "./types";
import { hasDocument } from "./types";

export interface Located {
  node: BinderNode;
  parent: BinderNode | null;
  siblings: BinderNode[];
  index: number;
}

export function locate(roots: BinderNode[], id: string): Located | null {
  const walk = (siblings: BinderNode[], parent: BinderNode | null): Located | null => {
    for (let index = 0; index < siblings.length; index++) {
      const node = siblings[index];
      if (node.id === id) return { node, parent, siblings, index };
      const found = walk(node.children, node);
      if (found) return found;
    }
    return null;
  };
  return walk(roots, null);
}

export function findNode(roots: BinderNode[], id: string | null): BinderNode | null {
  return id ? (locate(roots, id)?.node ?? null) : null;
}

/** The permanent root that owns `role`, if the project still has it. */
export function roleRoot(roots: BinderNode[], role: NodeRole): BinderNode | null {
  return roots.find((r) => r.role === role) ?? null;
}

/** The top-level root that `id` lives under, at any depth. */
export function rootContaining(roots: BinderNode[], id: string): BinderNode | null {
  const holds = (node: BinderNode): boolean =>
    node.id === id || node.children.some(holds);
  return roots.find(holds) ?? null;
}

/** Replace one node, rebuilding only the branch that contains it. */
export function updateNode(
  roots: BinderNode[],
  id: string,
  patch: Partial<BinderNode>,
): BinderNode[] {
  return roots.map(function step(node): BinderNode {
    if (node.id === id) return { ...node, ...patch };
    if (node.children.length === 0) return node;
    return { ...node, children: node.children.map(step) };
  });
}

export function removeNode(
  roots: BinderNode[],
  id: string,
): { roots: BinderNode[]; removed: BinderNode | null } {
  let removed: BinderNode | null = null;
  const prune = (siblings: BinderNode[]): BinderNode[] =>
    siblings
      .filter((node) => {
        if (node.id !== id) return true;
        removed = node;
        return false;
      })
      .map((node) =>
        node.children.length === 0 ? node : { ...node, children: prune(node.children) },
      );
  return { roots: prune(roots), removed };
}

/** Insert `node` as a child of `parentId` (or at top level when null). */
export function insertNode(
  roots: BinderNode[],
  parentId: string | null,
  index: number,
  node: BinderNode,
): BinderNode[] {
  if (parentId === null) {
    const next = [...roots];
    next.splice(clamp(index, 0, next.length), 0, node);
    return next;
  }
  return roots.map(function step(current): BinderNode {
    if (current.id === parentId) {
      const children = [...current.children];
      children.splice(clamp(index, 0, children.length), 0, node);
      return { ...current, children, expanded: true };
    }
    if (current.children.length === 0) return current;
    return { ...current, children: current.children.map(step) };
  });
}

/** Move a node one slot up or down among its siblings. */
export function shiftNode(roots: BinderNode[], id: string, delta: -1 | 1): BinderNode[] {
  const found = locate(roots, id);
  if (!found) return roots;
  const target = found.index + delta;
  if (target < 0 || target >= found.siblings.length) return roots;

  const reordered = [...found.siblings];
  [reordered[found.index], reordered[target]] = [reordered[target], reordered[found.index]];

  if (found.parent === null) return reordered;
  return updateNode(roots, found.parent.id, { children: reordered });
}

export interface Row {
  node: BinderNode;
  depth: number;
  parentId: string | null;
}

/** Flatten to the rows the binder actually shows, honouring collapsed folders. */
export function visibleRows(roots: BinderNode[]): Row[] {
  const rows: Row[] = [];
  const walk = (siblings: BinderNode[], depth: number, parentId: string | null) => {
    for (const node of siblings) {
      rows.push({ node, depth, parentId });
      if (node.children.length > 0 && node.expanded) {
        walk(node.children, depth + 1, node.id);
      }
    }
  };
  walk(roots, 0, null);
  return rows;
}

/** Every document in the tree, in reading order. */
export function allDocuments(roots: BinderNode[]): BinderNode[] {
  const out: BinderNode[] = [];
  const walk = (siblings: BinderNode[]) => {
    for (const node of siblings) {
      if (hasDocument(node.kind)) out.push(node);
      walk(node.children);
    }
  };
  walk(roots);
  return out;
}

/** Documents under the manuscript root that Export and the word count include. */
export function manuscriptDocuments(project: Project): BinderNode[] {
  const root = project.roots.find((r) => r.id === project.manuscriptRootId);
  if (!root) return [];
  const out: BinderNode[] = [];
  const walk = (node: BinderNode) => {
    if (!node.included) return;
    if (hasDocument(node.kind)) out.push(node);
    node.children.forEach(walk);
  };
  walk(root);
  return out;
}

/** Ancestor titles for the current document, outermost first. */
export function breadcrumb(roots: BinderNode[], id: string): string[] {
  const trail: string[] = [];
  const walk = (siblings: BinderNode[], above: string[]): boolean => {
    for (const node of siblings) {
      if (node.id === id) {
        trail.push(...above, node.title);
        return true;
      }
      if (walk(node.children, [...above, node.title])) return true;
    }
    return false;
  };
  walk(roots, []);
  return trail;
}

/** The next or previous document in reading order, for ⌘↑ / ⌘↓ navigation. */
export function siblingDocument(
  roots: BinderNode[],
  id: string | null,
  delta: -1 | 1,
): BinderNode | null {
  const docs = allDocuments(roots);
  if (docs.length === 0) return null;
  const at = docs.findIndex((d) => d.id === id);
  if (at === -1) return docs[delta === 1 ? 0 : docs.length - 1];
  return docs[at + delta] ?? null;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
