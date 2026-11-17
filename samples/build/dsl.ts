/**
 * Kekenik Shader sample Builder DSL (docs/SAMPLES.md). Authoring model:
 *
 *   const s = new Sample({ id, name, profile, settings });
 *   s.add(P.float("dissolve", "Dissolve", { default: 0.3, min: 0, max: 1, tooltip: "…", category: "Dissolve" }));
 *   s.use(fresnelKit());                                     // shared subgraph from samples/lib
 *   const b = s.block("mask", "Noise mask", "How it works…", { col: 0, color: COLORS.violet });
 *   b.n("noise", "noiseFbm", { values: { scale: 4 } });  s.w("noise.out", "step.in");  s.w("a.out", "b.in", "PortalName");
 *   s.build()  →  Graph   (positions, groups, notes, portals are all generated; identical input ⇒ identical output)
 */
import { type Graph, type Group, type Comment, type Keyword, type Property, type SubgraphDef, type SubgraphPort, type ShaderType, createGraph, makeProperty } from "@/core";
import { Canvas, type Block } from "./canvas";
import type { LayoutEnv } from "./layout";
import type { Tex } from "../textures/types";

export interface SampleInit {
  id: string;
  name: string;
  /** Unity URP profile the graph is authored for (`unity.urp.lit`, …). */
  profile: string;
  settings?: Record<string, string | number | boolean>;
}

export interface TextureBinding { propId: string; assetId: string; name: string; tex: Tex }

export class Sample extends Canvas {
  readonly props: Property[] = [];
  readonly keywords: Keyword[] = [];
  readonly subDefs: Record<string, SubgraphDef>;
  readonly textures: TextureBinding[] = [];

  constructor(readonly init: SampleInit, subDefs: Record<string, SubgraphDef> = {}) {
    const env: LayoutEnv = { subDefs, profileId: init.profile, settings: init.settings ?? {} };
    super(env);
    this.subDefs = subDefs;
  }

  add(...ps: Property[]): this { this.props.push(...ps); return this; }

  /** Register a shared subgraph definition (once; dependencies must be registered first). */
  use(def: SubgraphDef): this {
    if (!this.subDefs[def.id]) this.subDefs[def.id] = def;
    return this;
  }

  /** Bind a procedural texture to a texture property (embedded as a PNG asset, bound when the sample is opened). */
  texture(propId: string, name: string, tex: Tex): this {
    this.textures.push({ propId, name, assetId: `sample.${this.init.id}.${propId}`, tex });
    return this;
  }

  /** The Master Output node. */
  master(b: Block): string { return b.n("master", "masterOutput"); }

  build(): Graph {
    const { groups, comments } = this.arrange();
    return createGraph({
      id: this.init.id, name: this.init.name, nodes: this.nodes, edges: this.edgesRecord(), properties: this.props, keywords: this.keywords,
      groups, comments, subgraphDefs: this.subDefs, profileId: this.init.profile, settings: this.init.settings ?? {},
    });
  }
}

export interface SubgraphSpec {
  id: string;
  name: string;
  inputs: Array<Omit<SubgraphPort, "type"> & { type: ShaderType }>;
  outputs: Array<Omit<SubgraphPort, "type"> & { type: ShaderType }>;
}

class SubCanvas extends Canvas {
  constructor(private readonly spec: SubgraphSpec, subDefs: Record<string, SubgraphDef>) {
    super({ subDefs, io: { inputs: spec.inputs.map((p) => p.id), outputs: spec.outputs.map((p) => p.id) } });
    this.addNode(null, "inputs", "subgraphInputs", {});
    this.addNode(null, "outputs", "subgraphOutputs", {});
  }

  def(): SubgraphDef {
    const inNode = this.nodes.inputs!, outNode = this.nodes.outputs!;
    const { groups, comments, width } = this.arrange({ x: 300, y: 0 });
    this.nodes.inputs = { ...inNode, position: { x: 20, y: 0 } };
    this.nodes.outputs = { ...outNode, position: { x: 300 + width + 140, y: 0 } };
    const g: Group[] = groups, c: Comment[] = comments;
    return { id: this.spec.id, name: this.spec.name, inputs: this.spec.inputs, outputs: this.spec.outputs, nodes: this.nodes, edges: this.edgesRecord(), groups: g, comments: c };
  }
}

/**
 * Define a reusable subgraph. `build(c)` receives the body canvas: create blocks with `c.block(...)`, wire with `c.w(...)`; the boundary
 * nodes are `inputs` (outputs = the declared inputs) and `outputs` (inputs = the declared outputs). `deps` = subgraphs instantiated inside.
 */
export function defineSubgraph(spec: SubgraphSpec, build: (c: Canvas) => void, deps: SubgraphDef[] = []): SubgraphDef {
  const subDefs = Object.fromEntries(deps.map((d) => [d.id, d]));
  const c = new SubCanvas(spec, subDefs);
  build(c);
  return c.def();
}

/** Property constructors with the metadata every sample parameter must carry (header, tooltip, range, default). */
interface Common { tooltip: string; category: string }
export const P = {
  float: (id: string, name: string, o: Common & { default: number; min: number; max: number; slider?: boolean; step?: number }): Property =>
    makeProperty(id, name, "float", { default: o.default, min: o.min, max: o.max, slider: o.slider ?? true, ...(o.step ? { step: o.step } : {}), tooltip: o.tooltip, category: o.category }),
  int: (id: string, name: string, o: Common & { default: number; min: number; max: number }): Property =>
    makeProperty(id, name, "int", { default: o.default, min: o.min, max: o.max, tooltip: o.tooltip, category: o.category }),
  /** Colour (opaque `color` unless `alpha`). HDR colours are linear and may exceed 1; others are authored in sRGB. */
  color: (id: string, name: string, o: Common & { default: number[]; hdr?: boolean; alpha?: boolean }): Property =>
    makeProperty(id, name, o.alpha ? "color4" : "color", { default: o.default, tooltip: o.tooltip, category: o.category, colorSpace: o.hdr ? "linear" : "srgb", ...(o.hdr ? { hdr: true } : {}) }),
  vec2: (id: string, name: string, o: Common & { default: [number, number] }): Property => makeProperty(id, name, "vec2", { default: o.default, tooltip: o.tooltip, category: o.category }),
  vec3: (id: string, name: string, o: Common & { default: [number, number, number] }): Property => makeProperty(id, name, "vec3", { default: o.default, tooltip: o.tooltip, category: o.category }),
  bool: (id: string, name: string, o: Common & { default: boolean }): Property => makeProperty(id, name, "bool", { default: o.default, tooltip: o.tooltip, category: o.category }),
  tex: (id: string, name: string, o: Common & { default?: "white" | "black" | "grey" | "bump" | "red"; tilingOffset?: boolean }): Property =>
    makeProperty(id, name, "texture2D", { textureDefault: o.default ?? "white", tooltip: o.tooltip, category: o.category, ...(o.tilingOffset ? { tilingOffset: true } : {}) }),
};

export type { Block,  };
