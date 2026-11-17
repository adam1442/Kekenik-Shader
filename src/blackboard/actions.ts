import {
  type GraphOp,
  type Keyword,
  type KeywordKind,
  type Property,
  type PropertyType,
  type Vec2,
  canonicalFromDisplayName,
  clampKeywordValue,
  coerceValue,
  createNode,
  defaultValueFor,
  freeReferenceName,
  keywordUsage,
  makeProperty,
  ops,
  propertyUsage,
  sanitizeReferenceName,
  takenReferenceNames,
  uniquifyName,
  PROPERTY_TYPES,
} from "@/core";
import { type ProfileProblem, lockedReason, planProfileSwitch } from "@/core";
import { usePreview } from "@/preview/previewStore";
import { getCanvasApi } from "@/ui/graph/actions";
import { analysisFor, commit, getActiveDoc, getGraph, newNodeId } from "@/ui/graph/graphStore";
import { publishProfileProblems } from "@/ui/graph/panels/profileProblems";
import { resetMaterialValue } from "./materialStore";
import { ADD_PROPERTY_TYPES } from "./typeInfo";
import { useBlackboard } from "./store";

/** The ONLY place user-level Blackboard actions live (panel, menus, inspector, commands and tests all call these). */

const propertyOf = (id: string): Property | undefined => getGraph().properties.find((p) => p.id === id);
/** Why a property cannot be deleted / re-referenced (engine-bound property of the active profile), or undefined. */
export const propertyLock = (id: string): string | undefined => {
  const p = propertyOf(id);
  return p ? lockedReason(getGraph(), p) : undefined;
};
const keywordOf = (id: string): Keyword | undefined => getGraph().keywords.find((k) => k.id === id);
const names = (): string[] => [
  ...getGraph().properties.map((p) => p.displayName),
  ...getGraph().keywords.map((k) => k.displayName),
];

/* ── properties ────────────────────────────────────────────────────────────────────────────────── */
export function addProperty(typeId: string, opts: { category?: string; index?: number } = {}): string | null {
  const t = ADD_PROPERTY_TYPES.find((x) => x.id === typeId);
  if (!t) return null;
  const g = getGraph();
  const display = uniquifyName(t.label, new Set(names()));
  const ref = freeReferenceName(canonicalFromDisplayName(display), takenReferenceNames(g.properties, g.keywords));
  const id = newNodeId("prop");
  const p = makeProperty(id, display, t.type, {
    referenceName: ref,
    ...(t.patch ?? {}),
    ...(opts.category ? { category: opts.category } : {}),
  });
  if (!commit(`Add property ${display}`, ops.addProperty(p, opts.index))) return null;
  useBlackboard.getState().select({ kind: "property", id });
  return id;
}

/** Edit any property fields. A new default drops the material override so the change is visible in the Preview. */
export function updateProperty(id: string, patch: Partial<Property>, label = "Edit property"): boolean {
  if (!propertyOf(id)) return false;
  const p = { ...patch };
  if (propertyLock(id)) {
    delete p.referenceName;
    delete p.type;
    if (Object.keys(p).length === 0) return false;
  } // locked: reference + type are fixed
  if (p.referenceName !== undefined) p.referenceName = sanitizeReferenceName(p.referenceName);
  if ("default" in p) resetMaterialValue(id);
  return commit(label, ops.updateProperty(id, p));
}

/** Rename; the reference name follows while it is still the auto-generated one. */
export function renameProperty(id: string, displayName: string): boolean {
  const g = getGraph();
  const p = propertyOf(id);
  const name = displayName.trim();
  if (!p || !name || name === p.displayName) return false;
  const others = new Set(names().filter((n) => n !== p.displayName));
  const display = uniquifyName(name, others);
  const auto = canonicalFromDisplayName(p.displayName);
  const wasAuto = p.referenceName === auto || new RegExp(`^${auto}_\\d+$`).test(p.referenceName);
  const patch: Partial<Property> = { displayName: display };
  if (wasAuto)
    patch.referenceName = freeReferenceName(
      canonicalFromDisplayName(display),
      takenReferenceNames(g.properties, g.keywords, id),
    );
  return commit("Rename property", ops.updateProperty(id, patch));
}

export function duplicateProperty(id: string): string | null {
  const g = getGraph();
  const p = propertyOf(id);
  if (!p) return null;
  const display = uniquifyName(`${p.displayName} Copy`, new Set(names()));
  const ref = freeReferenceName(canonicalFromDisplayName(display), takenReferenceNames(g.properties, g.keywords));
  const nid = newNodeId("prop");
  const copy: Property = {
    ...p,
    id: nid,
    displayName: display,
    referenceName: ref,
    ...(p.enumValues ? { enumValues: p.enumValues.map((e) => ({ ...e })) } : {}),
  };
  if (!commit(`Duplicate ${p.displayName}`, ops.addProperty(copy, g.properties.findIndex((x) => x.id === id) + 1)))
    return null;
  useBlackboard.getState().select({ kind: "property", id: nid });
  return nid;
}

export const moveProperty = (id: string, toIndex: number): boolean =>
  commit("Reorder property", ops.moveProperty(id, toIndex));

/** How many nodes read this property (main graph + subgraph bodies). */
export const propertyUseCount = (id: string): number => propertyUsage(getGraph(), id).length;

/**
 * Delete a property. With `removeNodes` the Property nodes that read it go too; otherwise they stay and the graph reports
 * `E_UNKNOWN_PROPERTY` on each of them (the user decides what to do).
 */
export function deleteProperty(id: string, opts: { removeNodes?: boolean } = {}): boolean {
  const g = getGraph();
  if (!propertyOf(id) || propertyLock(id)) return false;
  const list: GraphOp[] = [];
  if (opts.removeNodes) for (const u of propertyUsage(g, id)) list.push(ops.removeNode(u.nodeId, u.scope));
  list.push(ops.removeProperty(id));
  const ok = commit("Delete property", list);
  if (ok) {
    resetMaterialValue(id);
    usePreview.getState().bind(id, null);
    const sel = useBlackboard.getState().selected;
    if (sel?.id === id) useBlackboard.getState().select(null);
  }
  return ok;
}

/** UI entry: delete straight away when unused, otherwise ask first (the panel renders the dialog). */
export function requestDeleteProperty(id: string): void {
  if (propertyLock(id)) return;
  if (propertyUseCount(id) === 0) void deleteProperty(id);
  else useBlackboard.getState().setPendingDelete({ kind: "property", id });
}

/* ── keywords ──────────────────────────────────────────────────────────────────────────────────── */
export function addKeyword(kind: KeywordKind): string | null {
  const g = getGraph();
  const display = uniquifyName(kind === "boolean" ? "Feature" : "Quality", new Set(names()));
  const ref = freeReferenceName(
    `_${display.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
    takenReferenceNames(g.properties, g.keywords),
  );
  const id = newNodeId("kw");
  const k: Keyword = {
    id,
    displayName: display,
    referenceName: ref,
    kind,
    definition: "shader_feature",
    scope: "local",
    default: 0,
    ...(kind === "enum" ? { entries: ["Low", "Medium", "High"] } : {}),
  };
  if (!commit(`Add keyword ${display}`, ops.addKeyword(k))) return null;
  useBlackboard.getState().select({ kind: "keyword", id });
  return id;
}

export function updateKeyword(id: string, patch: Partial<Keyword>, label = "Edit keyword"): boolean {
  const k = keywordOf(id);
  if (!k) return false;
  const p = { ...patch };
  if (p.referenceName !== undefined) p.referenceName = sanitizeReferenceName(p.referenceName);
  if (p.entries) {
    const next = { ...k, ...p };
    p.default = clampKeywordValue(next, p.default ?? k.default);
  }
  return commit(label, { type: "collUpdate", coll: "keywords", id, patch: p });
}

export function renameKeyword(id: string, displayName: string): boolean {
  const k = keywordOf(id);
  const name = displayName.trim();
  if (!k || !name || name === k.displayName) return false;
  return updateKeyword(
    id,
    { displayName: uniquifyName(name, new Set(names().filter((n) => n !== k.displayName))) },
    "Rename keyword",
  );
}

export function duplicateKeyword(id: string): string | null {
  const g = getGraph();
  const k = keywordOf(id);
  if (!k) return null;
  const display = uniquifyName(`${k.displayName} Copy`, new Set(names()));
  const nid = newNodeId("kw");
  const copy: Keyword = {
    ...k,
    id: nid,
    displayName: display,
    referenceName: freeReferenceName(`${k.referenceName}_COPY`, takenReferenceNames(g.properties, g.keywords)),
    ...(k.entries ? { entries: [...k.entries] } : {}),
  };
  if (!commit(`Duplicate ${k.displayName}`, ops.addKeyword(copy))) return null;
  useBlackboard.getState().select({ kind: "keyword", id: nid });
  return nid;
}

export const moveKeyword = (id: string, toIndex: number): boolean =>
  commit("Reorder keyword", { type: "collMove", coll: "keywords", id, toIndex });
export const keywordUseCount = (id: string): number => keywordUsage(getGraph(), id).length;

export function deleteKeyword(id: string, opts: { removeNodes?: boolean } = {}): boolean {
  const g = getGraph();
  if (!keywordOf(id)) return false;
  const list: GraphOp[] = [];
  if (opts.removeNodes) for (const u of keywordUsage(g, id)) list.push(ops.removeNode(u.nodeId, u.scope));
  list.push(ops.removeKeyword(id));
  const ok = commit("Delete keyword", list);
  if (ok) {
    const sel = useBlackboard.getState().selected;
    if (sel?.id === id) useBlackboard.getState().select(null);
  }
  return ok;
}

export function requestDeleteKeyword(id: string): void {
  if (keywordUseCount(id) === 0) void deleteKeyword(id);
  else useBlackboard.getState().setPendingDelete({ kind: "keyword", id });
}

/* ── graph ↔ blackboard ────────────────────────────────────────────────────────────────────────── */
const dropPos = (world?: Vec2): Vec2 => {
  const api = getCanvasApi();
  const p = world ?? api?.centerWorld() ?? { x: 0, y: 0 };
  return { x: Math.round(p.x), y: Math.round(p.y) };
};

/** Place a Property node reading `propId` (many uses are fine; the node only has a "Get" output). */
export function addPropertyNode(propId: string, world?: Vec2): string | null {
  const p = propertyOf(propId);
  if (!p) return null;
  const id = newNodeId("n");
  const node = createNode(id, "property", { position: dropPos(world), params: { property: propId } });
  return commit(`Add ${p.displayName}`, ops.addNode(node), { select: [id] }) ? id : null;
}

export function addKeywordNode(keywordId: string, world?: Vec2): string | null {
  const k = keywordOf(keywordId);
  if (!k) return null;
  const id = newNodeId("n");
  const node = createNode(id, k.kind === "boolean" ? "keywordBool" : "keywordEnum", {
    position: dropPos(world),
    params: { keyword: keywordId },
  });
  return commit(`Add ${k.displayName}`, ops.addNode(node), { select: [id] }) ? id : null;
}

/** Payload of a Blackboard drag (`property:<id>` | `keyword:<id>`) dropped on the canvas. */
export function dropOnCanvas(payload: string, world: Vec2): string | null {
  const [kind, ...rest] = payload.split(":");
  const id = rest.join(":");
  return kind === "property"
    ? addPropertyNode(id, { x: world.x - 20, y: world.y - 14 })
    : kind === "keyword"
      ? addKeywordNode(id, { x: world.x - 20, y: world.y - 14 })
      : null;
}

/** Turn an unconnected input port into a Property: creates the property with the port's current value and wires a Property node into it. */
export function promotePortToProperty(nodeId: string, portId: string): string | null {
  const g = getGraph();
  const node = g.nodes[nodeId];
  const res = analysisFor(g).main.info.get(nodeId)?.inputs[portId];
  if (!node || !res) return null;
  const type = res.target as PropertyType;
  if (!(PROPERTY_TYPES as readonly string[]).includes(type) || type === "texture2D") return null;
  if (Object.values(g.edges).some((e) => e.to.node === nodeId && e.to.port === portId)) return null;
  const raw = node.values[portId] ?? res.port.default;
  const flat = raw === undefined ? null : coerceValue(type, raw);
  const value =
    flat === null ? defaultValueFor(type) : type === "bool" ? flat[0] !== 0 : flat.length === 1 ? flat[0]! : flat;
  const display = uniquifyName(res.port.name, new Set(names()));
  const pid = newNodeId("prop");
  const p = makeProperty(pid, display, type, {
    default: value as Property["default"],
    referenceName: freeReferenceName(canonicalFromDisplayName(display), takenReferenceNames(g.properties, g.keywords)),
  });
  const pn = createNode(newNodeId("n"), "property", {
    position: { x: node.position.x - 240, y: node.position.y + 24 },
    params: { property: pid },
  });
  const list: GraphOp[] = [
    ops.addProperty(p),
    ops.addNode(pn),
    ops.connect({ node: pn.id, port: "out" }, { node: nodeId, port: portId }),
    ops.setPortValue(nodeId, portId, null),
  ];
  if (!commit(`Promote ${display} to property`, list, { select: [pn.id] })) return null;
  useBlackboard.getState().select({ kind: "property", id: pid });
  return pid;
}

/* ── organisation (headers, order) ─────────────────────────────────────────────────────────────── */
type Kind = "property" | "keyword";
const listOf = (kind: Kind): Array<{ id: string; category?: string }> =>
  kind === "property" ? getGraph().properties : getGraph().keywords;
const setCat = (kind: Kind, id: string, category: string | undefined): GraphOp =>
  kind === "property"
    ? ops.updateProperty(id, { category })
    : { type: "collUpdate", coll: "keywords", id, patch: { category } };
const moveOp = (kind: Kind, id: string, toIndex: number): GraphOp =>
  kind === "property" ? ops.moveProperty(id, toIndex) : { type: "collMove", coll: "keywords", id, toIndex };

/** Header (category) of one item; `undefined`/empty clears it. */
export const setCategory = (kind: Kind, id: string, category: string | undefined): boolean =>
  commit("Set header", setCat(kind, id, category?.trim() || undefined));

/** Rename a header: every item under it follows (one undo step). */
export function renameHeader(kind: Kind, from: string, to: string): boolean {
  const name = to.trim();
  if (!name || name === from) return false;
  const list = listOf(kind).filter((x) => x.category === from);
  return (
    list.length > 0 &&
    commit(
      "Rename header",
      list.map((x) => setCat(kind, x.id, name)),
    )
  );
}

/**
 * Drag-reorder: put `id` before / after `targetId` and adopt the target's header, as ONE undo step.
 * (`collMove` indices refer to the list AFTER removing the item.)
 */
export function reorderItem(kind: Kind, id: string, targetId: string, after: boolean): boolean {
  const list = listOf(kind);
  const from = list.findIndex((x) => x.id === id);
  const target = list.findIndex((x) => x.id === targetId);
  if (from < 0 || target < 0 || id === targetId) return false;
  let to = target + (after ? 1 : 0);
  if (from < to) to -= 1;
  const cat = list[target]!.category;
  const list2: GraphOp[] = [];
  if (list[from]!.category !== cat) list2.push(setCat(kind, id, cat));
  if (to !== from) list2.push(moveOp(kind, id, to));
  return list2.length > 0 && commit("Reorder", list2);
}

/** Move one step up / down inside the whole list (keyboard & menu). */
export function nudgeItem(kind: Kind, id: string, delta: -1 | 1): boolean {
  const list = listOf(kind);
  const i = list.findIndex((x) => x.id === id);
  const to = i + delta;
  return i >= 0 && to >= 0 && to < list.length && commit("Reorder", moveOp(kind, id, to));
}

export const toggleExposed = (id: string): boolean => {
  const p = propertyOf(id);
  return !!p && updateProperty(id, { exposed: !p.exposed }, p.exposed ? "Hide property" : "Expose property");
};

/** Switch the target profile (Graph Settings): the deterministic `planProfileSwitch` as ONE undoable transaction. Returns the problems (dropped blocks). */
export function switchTargetProfile(toId: string): ProfileProblem[] {
  const plan = planProfileSwitch(getGraph(), toId);
  if (plan.ops.length) commit("Switch target profile", plan.ops);
  const doc = getActiveDoc();
  if (doc) publishProfileProblems(doc.id, plan.problems);
  return plan.problems;
}
