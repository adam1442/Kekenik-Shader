import type { UniformEntry } from "../base/layout";
import type { Namer } from "../base/names";
import { stKey } from "../../properties/materialValues";

/**
 * Texture properties that expose Tiling / Offset get a hidden `vec4 <texture>_ST` uniform (x,y = tiling, z,w = offset — the same layout as Unity's
 * `_ST` and Godot's `_tiling` / `_offset` pair) and every sample of that texture uses `uv * st.xy + st.zw`. The extra entries are listed after the
 * other value uniforms; the dialect only declares the ones a stage actually reads.
 * `tiling` maps the texture's uniform identifier to the property id of its ST entry (see `GlslDialectOptions.tiling`).
 */
export function withTilingUniforms(
  entries: UniformEntry[],
  namer: Namer,
): { uniforms: UniformEntry[]; tiling: Map<string, string> } {
  const tiling = new Map<string, string>();
  const extra: UniformEntry[] = [];
  for (const e of entries) {
    if (e.kind !== "texture" || !e.property.tilingOffset) continue;
    const prop = stKey(e.prop);
    tiling.set(e.name, prop);
    extra.push({
      prop,
      ty: "vec4",
      name: namer.fresh(`${e.name}_ST`, "u"),
      kind: "value",
      property: {
        ...e.property,
        id: prop,
        type: "vec4",
        default: [1, 1, 0, 0],
        displayName: `${e.property.displayName} (Tiling / Offset)`,
        referenceName: `${e.property.referenceName}_ST`,
        tilingOffset: false,
      },
    });
  }
  if (extra.length === 0) return { uniforms: entries, tiling };
  const values = entries.filter((e) => e.kind === "value");
  return { uniforms: [...values, ...extra, ...entries.filter((e) => e.kind === "texture")], tiling };
}
