import { SPRITE_2D_PRAGMAS } from "../data/keywords";
import { type EmitCtx, isSpriteLit } from "./ctx";
import { spriteLitPasses } from "./spriteLit";
import { unlitForwardPass } from "./unlit";

export interface BuiltPasses {
  passes: string[];
  extra: string[];
  headerExtra: string[];
}

/** Sprite profiles. Sprite Unlit: `Universal2D` (2D Renderer) + `UniversalForward` (Universal Renderer) — same unlit code in both. */
export function spritePasses(ctx: EmitCtx): BuiltPasses {
  ctx.attrs.add("a_color");
  ctx.attrs.add("a_uv0");
  if (isSpriteLit(ctx.tp)) return spriteLitPasses(ctx);
  const o = { vertexColor: true };
  return {
    passes: [
      unlitForwardPass(ctx, {
        ...o,
        name: "Sprite Unlit 2D",
        lightMode: "Universal2D",
        pragma: [...SPRITE_2D_PRAGMAS],
      }),
      unlitForwardPass(ctx, { ...o, name: "Sprite Unlit Forward", lightMode: "UniversalForward" }),
    ],
    extra: [],
    headerExtra: [
      "// Sprite shader: SpriteRenderer binds the sprite to _MainTex and its tint to vertex colour. Not SRP-Batcher compatible.",
    ],
  };
}
