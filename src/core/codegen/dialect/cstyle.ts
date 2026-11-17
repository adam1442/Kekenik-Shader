import type { StorageType } from "../../types/shaderType";
import type { Dialect } from "./types";

/**
 * `writeFunction` of the C-family languages (GLSL, HLSL): `T name(params) { … return x; }`, or, for several outputs,
 * `void name(params, out T o0, out U o1) { … o0 = x; o1 = y; }`. `paramDecl` spells one parameter (HLSL adds a sampler after a texture).
 */
export function cStyleWriteFunction(
  typeName: (ty: StorageType) => string,
  paramDecl: (p: { name: string; ty: StorageType }) => string,
): Dialect["writeFunction"] {
  return (w, f, body, rets) => {
    const params = f.params.map(paramDecl);
    if (f.returns.length === 1) {
      w.line(`${typeName(f.returns[0]!.ty)} ${f.name}(${params.join(", ")}) {`);
      w.indent().append(body).dedent();
      w.indent().line(`return ${rets[0]};`).dedent().line("}");
    } else {
      const outs = f.returns.map((r) => `out ${typeName(r.ty)} ${r.name}`);
      w.line(`void ${f.name}(${[...params, ...outs].join(", ")}) {`);
      w.indent().append(body).dedent();
      f.returns.forEach((r, i) => w.indent().line(`${r.name} = ${rets[i]};`).dedent());
      w.line("}");
    }
  };
}

/** Statement spelling shared by GLSL and HLSL (`T x = e;`, `T x;`, `f(args, outs);`, `if (c) discard;`). */
export const cStyleStatements = (
  typeName: (ty: StorageType) => string,
): Pick<Dialect, "declare" | "declareUninit" | "callOuts" | "discardIf"> => ({
  declare: (ty, name, rhs) => `${typeName(ty)} ${name} = ${rhs};`,
  declareUninit: (ty, name) => `${typeName(ty)} ${name};`,
  callOuts: (fn, args, outs) => `${fn}(${[...args, ...outs].join(", ")});`,
  discardIf: (cond) => [`if (${cond}) discard;`],
});
