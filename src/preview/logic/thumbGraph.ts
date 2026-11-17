import {
  defaultNodeRegistry,
  type Graph,
  type ShaderType,
  analyzeGraph,
  applyOperation,
  createNode,
  makeProperty,
  ops,
  DEF_MASTER,
  isMatrix,
  isOpaque,
  isTextureType,
  type PropertyType,
  type GraphOp,
} from "@/core";

export type ThumbKind = "float" | "vec" | "color";

export interface ThumbGraph {
  graph: Graph;
  kind: ThumbKind;
  type: ShaderType;
}

const MASTER_COLOR = "Color";

/** First output port of a node (the one the thumbnail shows). */
export function primaryOutput(
  graph: Graph,
  nodeId: string,
): { port: string; type: ShaderType; semantic?: string } | null {
  const a = analyzeGraph(graph).main.info.get(nodeId);
  if (!a) return null;
  const port = a.ports.outputs[0];
  if (!port) return null;
  const type = a.outputs[port.id];
  return type ? { port: port.id, type, ...(port.tag?.semantic ? { semantic: port.tag.semantic } : {}) } : null;
}

function thumbKindOf(t: ShaderType): ThumbKind | null {
  if (isOpaque(t) || isMatrix(t)) return null;
  if (t === "color" || t === "color4") return "color";
  if (t === "float" || t === "int" || t === "bool") return "float";
  return "vec";
}

/**
 * Texture inputs that are neither wired nor defaulted (Sample Texture 2D, Parallax, Triplanar, LUT …) would make every thumbnail of such a
 * node — and of anything downstream — fail with `E_MISSING_INPUT`. For the thumbnail only, each gets a hidden texture Property (neutral grey,
 * or a flat normal for normal-semantic ports) read through a Property node. Walks upstream from `rootId`; the user's graph is never touched.
 */
function textureFillOps(graph: Graph, rootId: string): GraphOp[] {
  const info = analyzeGraph(graph).main.info;
  const wired = new Set(Object.values(graph.edges).map((e) => `${e.to.node}:${e.to.port}`));
  const seen = new Set<string>();
  const stack = [rootId];
  const steps: GraphOp[] = [];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of Object.values(graph.edges)) if (e.to.node === id) stack.push(e.from.node);
    const a = info.get(id);
    const node = graph.nodes[id];
    if (!a || !node) continue;
    for (const p of a.ports.inputs) {
      if (p.type.k !== "type" || !isTextureType(p.type.type)) continue;
      if (
        wired.has(`${id}:${p.id}`) ||
        p.optional ||
        p.defaultInput ||
        node.values[p.id] !== undefined ||
        p.default !== undefined
      )
        continue;
      const n = steps.length;
      const propId = `__thumb_tex${n}`;
      const prop = makeProperty(propId, `Thumb Tex ${n}`, p.type.type as PropertyType, {
        exposed: false,
        textureDefault: p.tag?.semantic === "normal" ? "bump" : "grey",
      });
      const reader = createNode(`__thumb_texnode${n}`, "property", {
        position: { x: node.position.x - 260, y: node.position.y + n },
        params: { property: propId },
      });
      steps.push(
        ops.addProperty(prop),
        ops.addNode(reader),
        ops.connect({ node: reader.id, port: "out" }, { node: id, port: p.id }),
      );
    }
  }
  return steps;
}

/**
 * A copy of `graph` whose Master Color shows the output of `nodeId`: master edges are removed, a Swizzle node widens the
 * value to a Vector 4 (float → `xxxx`, others → `xyzw`) and feeds Color. Returns null for nodes that cannot be previewed
 * (no outputs, textures, matrices, the master itself).
 */
export function buildThumbGraph(graph: Graph, nodeId: string): ThumbGraph | null {
  const node = graph.nodes[nodeId];
  if (!node || node.defId === DEF_MASTER) return null;
  const master = Object.values(graph.nodes).find((n) => n.defId === DEF_MASTER);
  if (!master) return null;
  const out = primaryOutput(graph, nodeId);
  const kind = out ? thumbKindOf(out.type) : null;
  if (!out || !kind) return null;

  // A thumbnail ALWAYS compiles under the portable `generic` profile (Color output). The user's profile (Unity Lit, Godot …) has no
  // "Color" block — connecting to it threw and every thumbnail silently became "no preview" (root cause of defect 0, notes).
  const steps: GraphOp[] = [
    ...textureFillOps(graph, nodeId),
    ...Object.values(graph.edges)
      .filter((e) => e.to.node === master.id)
      .map((e) => ops.disconnect(e.id)),
  ];
  if (graph.profileId !== "generic") steps.push(ops.setProfile("generic"));
  // Normal-semantic ports are directions in −1..1: show them remapped to 0..1 (n · 0.5 + 0.5), the usual normal-map look.
  let src = { node: nodeId, port: out.port };
  if (out.semantic === "normal" && kind === "vec") {
    const mul = createNode("__thumb_nmul", "multiply", {
      position: { x: master.position.x - 400, y: master.position.y },
      values: { b: 0.5 },
    });
    const add = createNode("__thumb_nadd", "add", {
      position: { x: master.position.x - 300, y: master.position.y },
      values: { b: 0.5 },
    });
    steps.push(
      ops.addNode(mul),
      ops.addNode(add),
      ops.connect(src, { node: mul.id, port: "a" }),
      ops.connect({ node: mul.id, port: "out" }, { node: add.id, port: "a" }),
    );
    src = { node: add.id, port: "out" };
  }
  const sw = createNode("__thumb_swizzle", "swizzle", {
    position: { x: master.position.x - 200, y: master.position.y },
    params: { mask: kind === "float" ? "xxxx" : "xyzw" },
  });
  steps.push(
    ops.addNode(sw),
    ops.connect(src, { node: sw.id, port: "in" }),
    ops.connect({ node: sw.id, port: "out" }, { node: master.id, port: MASTER_COLOR }),
  );
  try {
    let g = graph;
    for (const s of steps) g = applyOperation(g, s).graph;
    return { graph: g, kind, type: out.type };
  } catch {
    return null;
  }
}

/** Why a node has no thumbnail ("" when it has one) — shown as the tooltip of the "no preview" glyph. */
export function thumbSkipReason(graph: Graph, nodeId: string): string {
  const node = graph.nodes[nodeId];
  if (!node) return "Unknown node";
  if (node.defId === DEF_MASTER) return "The master output has no value to preview";
  const out = primaryOutput(graph, nodeId);
  if (!out) return "This node has no output to preview";
  if (isMatrix(out.type)) return "Matrix outputs have no thumbnail";
  if (isOpaque(out.type)) return "Texture / sampler outputs have no thumbnail (preview a Sample Texture node instead)";
  return "";
}

/** Cheap structural signature of a graph (ignores positions / selection-only data) — changes iff generated shaders may change. */
export function structureSignature(graph: Graph): string {
  const nodes = Object.values(graph.nodes)
    .map((n) => [n.id, n.defId, n.values, n.params])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const edges = Object.keys(graph.edges).sort();
  const props = graph.properties.map((p) => [p.id, p.type, p.referenceName, p.exposed]);
  return JSON.stringify([
    graph.profileId,
    nodes,
    edges,
    props,
    graph.settings,
    Object.keys(graph.subgraphDefs)
      .sort()
      .map((k) => JSON.stringify(graph.subgraphDefs[k])),
  ]);
}

/**
 * A thumbnail compile failed ONLY because of Godot `light`-stage data : every error is reported on a light-stage node
 * (`NodeDef.stage === "light"`, unavailable for the GLSL preview) or is a "light-only" stage violation. Such a value exists once per light
 * inside the engine, so the node (and everything fed by it) is shown as "no preview" instead of as an error.
 */
export function isLightStageOnly(
  graph: Graph,
  diagnostics: ReadonlyArray<{ severity: string; code: string; message: string; nodeId?: string }>,
): boolean {
  const errors = diagnostics.filter((d) => d.severity === "error");
  return (
    errors.length > 0 &&
    errors.every(
      (d) =>
        (d.code === "E_STAGE_VIOLATION" && /light-only/.test(d.message)) ||
        (!!d.nodeId && defaultNodeRegistry.get(graph.nodes[d.nodeId]?.defId ?? "")?.stage === "light"),
    )
  );
}
