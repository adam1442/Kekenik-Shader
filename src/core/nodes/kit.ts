import type { ExprId } from "../ir/types";
import { type ShaderType, componentCount, storageOf } from "../types/shaderType";
import { T, floatVec, numeric, sameAs } from "../types/generics";
import type { BuildContext, NodeDef, ParamSchema, PortDef, TargetAvailability } from "../registry/nodeDef";
import type { Intrinsic } from "../ir/intrinsics";
import { defineNode } from "./define";

/** Every shipped base node is available on all code targets (only the IR text printer is always allowed on top). */
export const ALL_TARGETS: TargetAvailability = { backends: ["glsl", "hlsl", "wgsl", "godot", "unity"] };

type Def = Parameters<typeof defineNode>[0];

/** `defineNode` + target availability for the base library. */
export const baseNode = (def: Def): NodeDef => defineNode({ targets: ALL_TARGETS, ...def });

/** Constant of the resolved type of `port` filled with `v` (scalar splat). */
export function fill(c: BuildContext, type: ShaderType, v: number): ExprId {
  const st = storageOf(type);
  return c.b.constOf(st, new Array<number>(componentCount(type)).fill(v));
}

/** Generic input port helper. */
export const fvIn = (id: string, name: string, def: number, group = "T"): PortDef => ({
  id,
  name,
  type: floatVec(group),
  default: def,
});
export const numIn = (id: string, name: string, def: number, group = "T"): PortDef => ({
  id,
  name,
  type: numeric(group),
  default: def,
});
/** Plain float input with default 0. */
export const floatIn = (id: string, name: string): PortDef => ({ id, name, type: T("float"), default: 0 });
export const outSame = (port: string, name = "Out"): PortDef => ({ id: "out", name, type: sameAs(port) });

/** Component-wise one-input intrinsic node (float vectors). */
export function unaryIntrinsic(
  id: string,
  name: string,
  fn: Intrinsic,
  category: string,
  description: string,
  synonyms: string[] = [],
): NodeDef {
  return baseNode({
    id,
    category,
    name,
    synonyms,
    description,
    inputs: [fvIn("in", "In", 0)],
    outputs: [outSame("in")],
    build: (c) => ({ out: c.b.intrinsic(fn, [c.in("in")]) }),
  });
}

/** Two-input component-wise intrinsic node (float vectors, shared generic group). */
export function binaryIntrinsic(
  id: string,
  name: string,
  fn: Intrinsic,
  category: string,
  description: string,
  synonyms: string[],
  defs: [number, number] = [0, 0],
  names: [string, string] = ["A", "B"],
): NodeDef {
  return baseNode({
    id,
    category,
    name,
    synonyms,
    description,
    inputs: [fvIn("a", names[0], defs[0]), fvIn("b", names[1], defs[1])],
    outputs: [outSame("a")],
    build: (c) => ({ out: c.b.intrinsic(fn, [c.in("a"), c.in("b")]) }),
  });
}

export const enumParam = (id: string, label: string, options: Array<[string, string]>, def: string): ParamSchema => ({
  id,
  label,
  control: "enum",
  default: def,
  options: options.map(([value, lbl]) => ({ value, label: lbl })),
});
