import { describe, expect, it } from "vitest";
import {
  allDocuments,
  breadcrumb,
  canDrop,
  findNode,
  homeRole,
  insertNode,
  locate,
  manuscriptDocuments,
  moveNode,
  removeNode,
  roleRoot,
  rootContaining,
  shiftNode,
  updateNode,
  visibleRows,
  within,
} from "./tree";
import type { BinderNode, NodeKind, Project } from "./types";

function node(
  id: string,
  kind: NodeKind = "chapter",
  children: BinderNode[] = [],
  extra: Partial<BinderNode> = {},
): BinderNode {
  return { id, title: id, kind, children, expanded: true, included: true, ...extra };
}

/**
 * Manuscript
 *   a, b, c
 *   part (folder)
 *     d
 * References
 *   map (reference)
 * Notes
 *   x (note)
 */
function project(): Project {
  const manuscript = node(
    "ms",
    "folder",
    [node("a"), node("b"), node("c"), node("part", "folder", [node("d")])],
    { role: "manuscript" },
  );
  const references = node("refs", "folder", [node("map", "reference", [], { file: "map.png" })], {
    role: "references",
  });
  const notes = node("notes", "folder", [node("x", "note")], { role: "notes" });
  return {
    schemaVersion: 2,
    title: "Salt",
    author: "",
    created: "",
    modified: "",
    roots: [manuscript, references, notes],
    manuscriptRootId: "ms",
    trash: [],
    targets: { manuscript: 0, daily: 0 },
  };
}

const ids = (nodes: BinderNode[]) => nodes.map((n) => n.id);

describe("lookup", () => {
  it("locates a node with its parent and position", () => {
    const { roots } = project();
    const found = locate(roots, "d");
    expect(found?.parent?.id).toBe("part");
    expect(found?.index).toBe(0);
    expect(locate(roots, "ms")?.parent).toBeNull();
    expect(locate(roots, "nope")).toBeNull();
    expect(findNode(roots, null)).toBeNull();
  });

  it("finds roots by role and the root that holds a node", () => {
    const { roots } = project();
    expect(roleRoot(roots, "notes")?.id).toBe("notes");
    expect(roleRoot(roots, "characters")).toBeNull();
    expect(rootContaining(roots, "d")?.id).toBe("ms");
    expect(rootContaining(roots, "map")?.id).toBe("refs");
  });

  it("knows which fixture each kind belongs in", () => {
    expect(homeRole("chapter")).toBe("manuscript");
    expect(homeRole("character")).toBe("characters");
    expect(homeRole("reference")).toBe("references");
    expect(homeRole("note")).toBe("notes");
    expect(homeRole("folder")).toBeNull();
  });

  it("tells whether a node sits under another", () => {
    const { roots } = project();
    expect(within(roots, "part", "d")).toBe(true);
    expect(within(roots, "part", "part")).toBe(true);
    expect(within(roots, "d", "part")).toBe(false);
    expect(within(roots, "gone", "d")).toBe(false);
  });
});

describe("editing", () => {
  it("updates one node without touching the others", () => {
    const { roots } = project();
    const next = updateNode(roots, "d", { title: "Scene" });
    expect(findNode(next, "d")?.title).toBe("Scene");
    expect(findNode(next, "a")).toBe(findNode(roots, "a")); // untouched branch is the same object
  });

  it("removes a node and hands it back", () => {
    const { roots } = project();
    const { roots: next, removed } = removeNode(roots, "part");
    expect(removed?.id).toBe("part");
    expect(ids(next[0].children)).toEqual(["a", "b", "c"]);
    expect(removeNode(roots, "nope").removed).toBeNull();
  });

  it("inserts at a clamped index and opens the parent", () => {
    const { roots } = project();
    const closed = updateNode(roots, "part", { expanded: false });
    const next = insertNode(closed, "part", 99, node("e"));
    expect(ids(findNode(next, "part")!.children)).toEqual(["d", "e"]);
    expect(findNode(next, "part")?.expanded).toBe(true);
    expect(ids(insertNode(roots, null, 0, node("top", "folder")))).toEqual([
      "top",
      "ms",
      "refs",
      "notes",
    ]);
  });

  it("shifts a node among its siblings and stops at the ends", () => {
    const { roots } = project();
    expect(ids(shiftNode(roots, "b", 1)[0].children)).toEqual(["a", "c", "b", "part"]);
    expect(ids(shiftNode(roots, "a", -1)[0].children)).toEqual(["a", "b", "c", "part"]);
    expect(ids(shiftNode(roots, "refs", 1))).toEqual(["ms", "notes", "refs"]);
  });
});

describe("moveNode", () => {
  it("uses the index as it looked before the move", () => {
    const { roots } = project();
    // Down: the indicator was before "part" (index 3), the node lands third.
    expect(ids(moveNode(roots, "a", "ms", 3)[0].children)).toEqual(["b", "c", "a", "part"]);
    // Up.
    expect(ids(moveNode(roots, "c", "ms", 0)[0].children)).toEqual(["c", "a", "b", "part"]);
  });

  it("dropping beside itself changes nothing", () => {
    const { roots } = project();
    expect(ids(moveNode(roots, "b", "ms", 1)[0].children)).toEqual(["a", "b", "c", "part"]);
    expect(ids(moveNode(roots, "b", "ms", 2)[0].children)).toEqual(["a", "b", "c", "part"]);
  });

  it("moves into and out of folders", () => {
    const { roots } = project();
    const into = moveNode(roots, "a", "part", 0);
    expect(ids(into[0].children)).toEqual(["b", "c", "part"]);
    expect(ids(findNode(into, "part")!.children)).toEqual(["a", "d"]);

    const out = moveNode(roots, "d", "ms", 4);
    expect(ids(out[0].children)).toEqual(["a", "b", "c", "part", "d"]);
    expect(findNode(out, "part")?.children).toEqual([]);
  });

  it("leaves the tree alone for an unknown node", () => {
    const { roots } = project();
    expect(moveNode(roots, "nope", "ms", 0)).toBe(roots);
  });
});

describe("canDrop", () => {
  const p = project();

  it("keeps chapters inside the manuscript", () => {
    expect(canDrop(p, "a", "part")).toBe(true);
    expect(canDrop(p, "a", "notes")).toBe(false);
  });

  it("lets other kinds go anywhere but into a reference", () => {
    expect(canDrop(p, "x", "ms")).toBe(true);
    expect(canDrop(p, "x", "map")).toBe(false);
  });

  it("refuses a node's own subtree and the permanent roots", () => {
    expect(canDrop(p, "part", "d")).toBe(false);
    expect(canDrop(p, "part", "part")).toBe(false);
    expect(canDrop(p, "ms", "notes")).toBe(false);
    expect(canDrop(p, "a", "gone")).toBe(false);
  });
});

describe("reading order", () => {
  it("flattens to the rows on screen, honouring collapsed folders", () => {
    const { roots } = project();
    const open = visibleRows(roots).map((r) => r.node.id);
    expect(open).toEqual(["ms", "a", "b", "c", "part", "d", "refs", "map", "notes", "x"]);
    const closed = visibleRows(updateNode(roots, "part", { expanded: false }));
    expect(closed.map((r) => r.node.id)).not.toContain("d");
    expect(closed.find((r) => r.node.id === "d")).toBeUndefined();
    expect(visibleRows(roots).find((r) => r.node.id === "d")?.depth).toBe(2);
  });

  it("lists documents, and the manuscript skips excluded chapters", () => {
    const p = project();
    expect(ids(allDocuments(p.roots))).toEqual(["a", "b", "c", "d", "x"]);
    expect(ids(manuscriptDocuments(p))).toEqual(["a", "b", "c", "d"]);
    const excluded = { ...p, roots: updateNode(p.roots, "part", { included: false }) };
    expect(ids(manuscriptDocuments(excluded))).toEqual(["a", "b", "c"]);
  });

  it("builds a breadcrumb from the root down", () => {
    const { roots } = project();
    expect(breadcrumb(roots, "d")).toEqual(["ms", "part", "d"]);
    expect(breadcrumb(roots, "nope")).toEqual([]);
  });
});
