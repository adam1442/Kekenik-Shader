import type { Generated } from "../../dialect/generate";
import type { BlockDef } from "../../../profiles/types";
import { type EmitCtx, type SliceId, HLSL_BLOCK_TYPE, defaultText, indent, isSpriteLit } from "./ctx";

/** `struct KsSurface` — one field per active fragment block (shared by every slice function). */
export function surfaceStruct(ctx: EmitCtx): string {
  const lines = ctx.fragmentBlocks.map((b) => `    ${HLSL_BLOCK_TYPE[b.type] ?? "float"} ${b.id};`);
  return `struct KsSurface\n{\n${lines.join("\n")}\n};`;
}

/** Slots (canonical block ids) each slice evaluates. */
export function sliceSlots(ctx: EmitCtx, id: SliceId): string[] {
  const has = (b: string): boolean => ctx.fragmentBlocks.some((x) => x.id === b);
  if (id === "forward") return ctx.fragmentBlocks.map((b) => b.id);
  // VFX has a single colour pass: the alpha / normals slices would be dead code.
  if (ctx.tp.family === "vfx") return [];
  // Sprite Lit writes the sprite alpha into the normals buffer, so its normals slice always carries `alpha`.
  const alpha = ctx.o.clipCode
    ? ["alpha", "alphaClipThreshold"].filter(has)
    : isSpriteLit(ctx.tp) && id === "normals"
      ? ["alpha"].filter(has)
      : [];
  return id === "alpha" ? alpha : [...alpha, ...(has("normalTS") ? ["normalTS"] : [])];
}

/** `KsSurface KsSurface_<Slice>()` evaluating the sliced fragment graph. */
export function surfaceFunction(ctx: EmitCtx, id: SliceId, g: Generated): string {
  const slots = new Set(sliceSlots(ctx, id));
  const out: string[] = [`KsSurface KsSurface_${id}()`, "{"];
  const body = g.fragment.body.toString().trim();
  if (body) out.push(indent(body));
  out.push("    KsSurface s = (KsSurface)0;");
  for (const b of ctx.fragmentBlocks as BlockDef[]) {
    if (!slots.has(b.id)) continue;
    const ex = g.fragment.slotExprs[b.id];
    out.push(`    s.${b.id} = ${ex ?? defaultText(b)};`);
  }
  out.push("    return s;", "}");
  return out.join("\n");
}
