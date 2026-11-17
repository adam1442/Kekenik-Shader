import type { SceneTarget } from "../engine/targets";
import type { DiagnosticCode } from "../diagnostics";
import type { Graph, NodeInstance, ParamValue, PortValue, SubgraphDef } from "../graph/types";
import type { IRBuilder } from "../ir/builder";
import type { BuiltinInput } from "../ir/inputs";
import type { BackendId, ExprId } from "../ir/types";
import type { Property } from "../properties/model";
import type { Space, TypeTag } from "../types/semantics";
import type { ShaderType } from "../types/shaderType";
import type { TypeSpec } from "../types/generics";
import type { ProfileDef } from "./profile";

/** UI control schema of a node parameter (the UI renders it; the core only stores the value). */
type ParamControl = "number" | "int" | "bool" | "enum" | "string" | "color" | "vector";

export interface ParamSchema {
  id: string;
  label: string;
  control: ParamControl;
  default: ParamValue;
  /** Value written onto NEWLY created nodes when it differs from `default` (which is what stored nodes without the param mean — keeps old files unchanged). */
  newDefault?: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
  tooltip?: string;
}

export interface PortDef {
  id: string;
  name: string;
  type: TypeSpec;
  /** Inline value used when the port is unconnected. */
  default?: PortValue;
  tag?: TypeTag;
  /** Unconnected + no default is fine. */
  optional?: boolean;
  /** Hover text of the port (subgraph instances show the I/O tooltip). */
  tooltip?: string;
  /** Header of the port group this port starts/belongs to (Master Output: "Vertex" / "Fragment"); the canvas draws one header row per group. */
  section?: string;
  /** Port is kept (and its wire) but currently has no effect — drawn dimmed (Master Output blocks whose option is off). */
  inactive?: boolean;
  /** Unconnected → fetch this built-in input (e.g. UV ports default to uv0). */
  defaultInput?: { input: BuiltinInput; space?: Space };
}

export interface ResolvedPorts {
  inputs: PortDef[];
  outputs: PortDef[];
}

/** Everything a node needs to know about its surroundings to compute its ports. */
export interface PortContext {
  graph: Graph;
  /** Subgraph id when the node lives in a subgraph body. */
  scope?: string;
  profile?: ProfileDef;
}

interface NodeIssue {
  code: DiagnosticCode;
  message: string;
  portId?: string;
}

/** Where a node may be exported. Missing field = unrestricted. */
export interface TargetAvailability {
  backends?: BackendId[];
  profiles?: string[];
}

export interface BuildContext {
  /** IR builder of the body being compiled. */
  b: IRBuilder;
  node: NodeInstance;
  graph: Graph;
  scope?: string;
  /** Value of input `port` converted to its resolved type (storage form). Falls back to inline value / default. */
  in(port: string): ExprId;
  /** Is the input fed by a wire? */
  connected(port: string): boolean;
  /** Resolved (post-inference) type of an input or output port. */
  inType(port: string): ShaderType;
  outType(port: string): ShaderType;
  /** Parameter value (schema default when unset). */
  param<T extends ParamValue = ParamValue>(id: string): T;
  /** Read an exposed property as a uniform (registers it in the module). */
  uniform(propertyId: string): ExprId;
  property(propertyId: string): Property | undefined;
  /** Active value of a keyword in the variant being built (boolean 0/1, enum entry index). Unknown id → 0. */
  keyword(keywordId: string): number;
  /**
   * Runtime keyword read . Only defined when the backend keeps keywords as real shader variants
   * (`CompileOptions.runtimeKeywords`, Unity `shader_feature_local`): an `int` expression holding the keyword's value
   * (boolean 0/1, enum entry index). `undefined` ⇒ bake the branch with `keyword()`. `static` keywords always bake.
   */
  keywordSelector(keywordId: string): ExprId | undefined;
  subgraph(id: string): SubgraphDef | undefined;
  /** Abort this node's build with an E_BUILD_FAILED diagnostic. */
  fail(message: string): never;
  /** Attach a non-fatal diagnostic (warning) to this node. Additive . */
  warn(code: "W_HEIGHT_NORMAL_NO_DEPENDENCY" | "W_HEIGHT_NORMAL_COST", message: string): void;
  /** Compile-time target of this compilation (the SIMULATED target when the host asks for one; `ir` printer = glsl). Additive . */
  target: SceneTarget;
  /** True when compiled for the Kekenik Shader preview viewport. Additive . */
  isPreview: boolean;
}

export interface NodeDef {
  /** Stable forever. Pattern: `^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$`. */
  id: string;
  category: string;
  name: string;
  synonyms: string[];
  description: string;
  inputs: PortDef[];
  outputs: PortDef[];
  params: ParamSchema[];
  targets?: TargetAvailability;
  /** Per-target notes / limitations shown in docs and the Node Gallery (`all` applies to every target). Additive . */
  targetNotes?: Partial<Record<BackendId | "all", string>>;
  /** New instances created from the UI start with their in-node preview enabled (the Preview node). Additive . */
  previewByDefault?: boolean;
  /**
   * Stage the node is legal in: "vertex" = vertex-only (e.g. Wave Deformation), "fragment" = fragment-only (e.g. Scene Depth).
   * Absent = any stage. Enforced by the compiler (`E_STAGE_VIOLATION` on the node) on top of the per-IR-op stage rules. Additive .
   */
  stage?: "vertex" | "fragment" | "light";
  /** Render-pipeline / host capabilities the node needs (e.g. "depthTexture", "opaqueTexture", "customVertexStreams"). Documentation + gallery metadata. Additive . */
  capabilities?: string[];
  /**
   * Compile-time input selection (Target Switch): the ports that are LIVE for `target`. Edges into every other input are
   * ignored by reachability, so nodes that only feed a dead branch are neither built nor validated against the target. Additive .
   */
  liveInputs?: (node: NodeInstance, target: SceneTarget) => string[];
  /** reroute / portals: removed by the flatten pass, never built. */
  structural?: boolean;
  /** Ports that depend on the graph (properties, subgraph signatures, profile blocks). Overrides inputs/outputs. */
  dynamicPorts?: (node: NodeInstance, ctx: PortContext) => ResolvedPorts;
  /** Extra semantic checks (unknown property, unknown subgraph, …). */
  validate?: (node: NodeInstance, ctx: PortContext) => NodeIssue[];
  /** Produce one IR expression per output port (storage type of the resolved output type). */
  build?: (ctx: BuildContext) => Record<string, ExprId>;
}

/** Ports of a node instance (dynamic when the def says so). */
export function getNodePorts(def: NodeDef, node: NodeInstance, ctx: PortContext): ResolvedPorts {
  return def.dynamicPorts ? def.dynamicPorts(node, ctx) : { inputs: def.inputs, outputs: def.outputs };
}

/** Param value or schema default. */
export function paramOf<T extends ParamValue = ParamValue>(def: NodeDef, node: NodeInstance, id: string): T {
  if (id in node.params) return node.params[id] as T;
  return def.params.find((p) => p.id === id)?.default as T;
}

/** Parameters written onto a NEWLY created node (those with `newDefault`); stored nodes without them keep the schema `default`. */
export function newParamDefaults(def: Pick<NodeDef, "params">): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const p of def.params) if (p.newDefault !== undefined) out[p.id] = p.newDefault;
  return out;
}
