import { type ShaderType, componentCount, floatVecOfSize, storageOf } from "../types/shaderType";
import { getConversion } from "../types/conversion";
import { IRBuilder, IRBuildError } from "./builder";
import type { ExprId } from "./types";

/**
 * Emit the IR for an implicit conversion `from → to` (port types, so color semantics are visible).
 * Splat → construct(scalar), truncate → swizzle, pad → construct(src, pad…), reinterpret → cast or no-op.
 */
export function emitConversion(b: IRBuilder, src: ExprId, from: ShaderType, to: ShaderType): ExprId {
  const conv = getConversion(from, to);
  const sf = storageOf(from);
  const st = storageOf(to);
  switch (conv.kind) {
    case "forbidden":
      throw new IRBuildError(`Cannot convert ${from} to ${to}`);
    case "exact":
      return src;
    case "reinterpret":
      return sf === st ? src : b.cast(src, st);
    case "splat": {
      const s = sf === "float" ? src : b.cast(src, "float");
      return b.construct(st, [s]);
    }
    case "truncate":
      return b.swizzle(src, "xyzw".slice(0, componentCount(to)));
    case "pad": {
      const missing = componentCount(to) - componentCount(from);
      const pad = new Array<number>(missing).fill(0);
      if (conv.padValue === 1) pad[missing - 1] = 1;
      return b.construct(st, [src, b.constOf(floatVecOfSize(missing), pad)]);
    }
  }
}
