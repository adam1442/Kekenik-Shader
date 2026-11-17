import type { EmitCtx } from "./ctx";

/** Threshold used by the clip statements: the graph's `alphaClipThreshold` block, or the material property `_Cutoff` (E3, block unconnected). */
const cutoffExpr = (ctx: EmitCtx): string => (ctx.cutoffProp ? "_Cutoff" : "s.alphaClipThreshold");

/** Alpha-clip statement(s) (4-space indented). With runtime surface options the clip sits behind `_ALPHATEST_ON` (toggled by the `_AlphaClip` material property). */
export function clipLines(ctx: EmitCtx): string[] {
  const c = `clip(s.alpha - ${cutoffExpr(ctx)});`;
  return ctx.o.exposeSurface ? ["#if defined(_ALPHATEST_ON)", `    ${c}`, "#endif"] : [`    ${c}`];
}

/** LOD cross-fade dither (E1): `LODFadeCrossFade` is a no-op unless `LOD_FADE_CROSSFADE` is compiled. */
export const lodFadeLines = (ctx: EmitCtx, positionCS: string): string[] =>
  ctx.o.lodCrossFade ? [`    LODFadeCrossFade(${positionCS});`] : [];
