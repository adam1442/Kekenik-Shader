import type { PortDef } from "../registry/nodeDef";
import { defineNode } from "../nodes/define";
import { ALL_TARGETS } from "../nodes/kit";
import { T } from "../types/generics";
import { storageOf } from "../types/shaderType";
import { CUSTOM_FN_DEF, CUSTOM_FN_PARAM, CUSTOM_TARGETS, bodyFor, includeFor, parseSpec, validateSpec } from "./spec";

const portDef = (p: { name: string; type: import("../types/shaderType").ShaderType }): PortDef => ({
  id: p.name,
  name: p.name,
  type: T(p.type),
});

/**
 * Custom Function: hand-written code per target with typed inputs / outputs. The node's ports follow the spec; the compiler turns it
 * into an opaque IR block that each backend lowers to a native function (`custom/lower.ts`).
 */
export const customFunctionNode = defineNode({
  id: CUSTOM_FN_DEF,
  category: "Custom",
  name: "Custom Function",
  synonyms: ["code", "hlsl", "glsl", "wgsl", "snippet", "function"],
  description:
    "Write the function body per target (GLSL / HLSL / WGSL / Godot / Unity). Inputs are read by name; assign every output by name.",
  targets: ALL_TARGETS,
  targetNotes: {
    all: "Each target needs its own body (or the shared GLSL / HLSL family body). Bodies are never translated.",
  },
  params: [{ id: CUSTOM_FN_PARAM, label: "Definition", control: "string", default: "" }],
  dynamicPorts: (node) => {
    const s = parseSpec(node.params[CUSTOM_FN_PARAM]);
    return { inputs: s.inputs.map(portDef), outputs: s.outputs.map(portDef) };
  },
  validate: (node) =>
    validateSpec(parseSpec(node.params[CUSTOM_FN_PARAM])).map((message) => ({
      code: "E_BUILD_FAILED" as const,
      message,
    })),
  build: (ctx) => {
    const s = parseSpec(ctx.node.params[CUSTOM_FN_PARAM]);
    const id = `cf_${ctx.node.id}`;
    const code: Partial<Record<(typeof CUSTOM_TARGETS)[number], string>> = {};
    const include: Partial<Record<(typeof CUSTOM_TARGETS)[number], string>> = {};
    for (const t of CUSTOM_TARGETS) {
      const b = bodyFor(s, t);
      if (b !== undefined && b.trim() !== "") code[t] = b;
      const inc = includeFor(s, t);
      if (inc) include[t] = inc;
    }
    ctx.b.env.customBlocks.set(id, {
      id,
      name: s.name || "custom",
      inputs: s.inputs.map((p) => ({ name: p.name, ty: storageOf(p.type) })),
      outputs: s.outputs.map((p) => ({ name: p.name, ty: storageOf(p.type) })),
      code,
      ...(Object.keys(include).length ? { include } : {}),
    });
    const args = s.inputs.map((p) => ctx.in(p.name));
    return Object.fromEntries(s.outputs.map((o, i) => [o.name, ctx.b.custom(id, args, i)]));
  },
});
