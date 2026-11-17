import { SPATIAL_SCOPES, type ScopeRow } from "./builtinScopes";
import type { FactStatus } from "./versions";

/** Built-in variables per shader type / processor function (docs/EXPORT_TARGETS.md A.3 / A.5). `access`: in = read-only, out = write-only, inout = both. */
export type Access = "in" | "out" | "inout";
export interface BuiltinDef {
  name: string;
  type: string;
  access: Access;
  status: FactStatus;
}
export type Fn = "global" | "vertex" | "fragment" | "light";
export type BuiltinTable = Record<string, Partial<Record<Fn, BuiltinDef[]>>>;

const V: FactStatus = "verified";
const K: FactStatus = "unverified-by-doc";
const b = (name: string, type: string, access: Access, status: FactStatus = V): BuiltinDef => ({
  name,
  type,
  access,
  status,
});

const fromDocs = (rows: readonly ScopeRow[]): BuiltinDef[] => rows.map(([n, t, a]) => b(n, t, a));
/** canvas_item global built-ins (docs canvas_item_shader.html). */
const GLOBAL = [b("TIME", "float", "in"), b("PI", "float", "in"), b("TAU", "float", "in"), b("E", "float", "in")];

const BUILTINS: BuiltinTable = {
  spatial: {
    global: fromDocs(SPATIAL_SCOPES.global),
    vertex: fromDocs(SPATIAL_SCOPES.vertex),
    fragment: fromDocs(SPATIAL_SCOPES.fragment),
    light: fromDocs(SPATIAL_SCOPES.light),
  },
  canvas_item: {
    global: GLOBAL,
    vertex: [
      b("VERTEX", "vec2", "inout"),
      b("UV", "vec2", "inout"),
      b("COLOR", "vec4", "inout"),
      b("MODEL_MATRIX", "mat4", "in"),
      b("AT_LIGHT_PASS", "bool", "in"),
      b("TEXTURE_PIXEL_SIZE", "vec2", "in"),
      b("CANVAS_MATRIX", "mat4", "in"),
      b("SCREEN_MATRIX", "mat4", "in"),
      b("INSTANCE_ID", "int", "in"),
      b("INSTANCE_CUSTOM", "vec4", "in"),
      b("CUSTOM0", "vec4", "in"),
      b("CUSTOM1", "vec4", "in"),
      b("POINT_SIZE", "float", "inout"),
      b("VERTEX_ID", "int", "in", K),
    ],
    fragment: [
      b("COLOR", "vec4", "inout"),
      b("UV", "vec2", "in"),
      b("SCREEN_UV", "vec2", "in"),
      b("TEXTURE", "sampler2D", "in"),
      b("TEXTURE_PIXEL_SIZE", "vec2", "in"),
      b("SCREEN_PIXEL_SIZE", "vec2", "in"),
      b("REGION_RECT", "vec4", "in"),
      b("NORMAL_TEXTURE", "sampler2D", "in"),
      b("NORMAL", "vec3", "inout"),
      b("NORMAL_MAP", "vec3", "out"),
      b("NORMAL_MAP_DEPTH", "float", "out"),
      b("FRAGCOORD", "vec4", "in"),
      b("POINT_COORD", "vec2", "in"),
      b("AT_LIGHT_PASS", "bool", "in"),
      b("SPECULAR_SHININESS", "vec4", "inout"),
    ],
  },
};

export const builtinsFor = (shaderType: string, fn: Fn): BuiltinDef[] => [
  ...(BUILTINS[shaderType]?.global ?? []),
  ...(BUILTINS[shaderType]?.[fn] ?? []),
];
export const builtinFor = (shaderType: string, fn: Fn, name: string): BuiltinDef | undefined =>
  builtinsFor(shaderType, fn).find((x) => x.name === name);
export const allBuiltinNames = (): string[] => [
  ...new Set(Object.values(BUILTINS).flatMap((t) => Object.values(t).flatMap((l) => (l ?? []).map((x) => x.name)))),
];
export const isWritable = (a: Access): boolean => a === "out" || a === "inout";
