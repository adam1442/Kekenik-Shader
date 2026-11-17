import { isTextureType } from "../../types/shaderType";
import type { IRFunction } from "../../ir/types";

/** Trailing comment of an include emitted for a Custom Function in file mode (the Unity include whitelist skips such lines: the path is the user's own file). */
const CUSTOM_INCLUDE_MARK = "Custom Function (file)";
import { type Namer, snakeCase } from "../base/names";
import { bodyOrderUses } from "../base/stageSplit";
import { CodeWriter } from "../base/writer";
import { BodyEmitter } from "./emitter";
import { type Dialect, type DialectServices, samplerOf } from "./types";

/**
 * Source of one IR function (subgraph) in the language of `dialect`: parameters and outputs get readable names,
 * a single return value is returned, several become `out` parameters (shape decided by `dialect.writeFunction`).
 * `namer` is the function's own scope (a child of the module namer); `fname` is the already-chosen function name.
 */
export function emitIrFunction(
  dialect: Dialect,
  f: IRFunction,
  fname: string,
  namer: Namer,
  svc: DialectServices,
): CodeWriter {
  if (f.native !== undefined) return emitNativeFunction(dialect, f, fname, namer);
  const paramNames = f.params.map((p) => {
    const fresh = (): string => namer.fresh(snakeCase(p.name) || "p", "p");
    let n = fresh();
    // A texture parameter owns the identifier `<name>_sampler` in the languages with separate samplers.
    if (dialect.separateSamplers && isTextureType(p.ty)) {
      while (namer.has(samplerOf(n))) n = fresh();
      namer.reserve(samplerOf(n));
    }
    return n;
  });
  const { order, uses } = bodyOrderUses(f.body, f.ret);
  const body = new CodeWriter();
  const be = new BodyEmitter({ dialect, body: f.body, bodyId: f.id, order, uses, namer, w: body, paramNames, svc });
  be.emitStatements();
  const outNames = f.returns.length === 1 ? [] : f.returns.map((r) => namer.fresh(snakeCase(r.name) || "out", "o"));
  const out = new CodeWriter();
  dialect.writeFunction(
    out,
    {
      name: fname,
      params: f.params.map((p, i) => ({ name: paramNames[i]!, ty: p.ty })),
      returns: f.returns.map((r, i) => ({ name: outNames[i] ?? r.name, ty: r.ty })),
    },
    body,
    f.ret.map((id) => be.bare(id)),
  );
  return out;
}

/**
 * Custom Function node: the user's statements read the parameters by their own names and assign locals named like the outputs;
 * the function wrapper (return value or `out` parameters) is the dialect's usual one, so every language shape stays consistent.
 */
function emitNativeFunction(dialect: Dialect, f: IRFunction, fname: string, namer: Namer): CodeWriter {
  const paramNames = f.params.map((p) => {
    if (dialect.separateSamplers && isTextureType(p.ty)) namer.reserve(samplerOf(p.name));
    return p.name;
  });
  const body = new CodeWriter();
  for (const r of f.returns) body.line(dialect.declareUninit(r.ty, r.name));
  body.raw(f.native ?? "");
  const out = new CodeWriter();
  if (f.include !== undefined) out.line(`#include "${f.include}" // ${CUSTOM_INCLUDE_MARK}`);
  dialect.writeFunction(
    out,
    {
      name: fname,
      params: f.params.map((p, i) => ({ name: paramNames[i]!, ty: p.ty })),
      returns: f.returns.map((r, i) => ({ name: f.returns.length === 1 ? r.name : `ks_out${i}`, ty: r.ty })),
    },
    body,
    f.returns.map((r) => r.name),
  );
  return out;
}
