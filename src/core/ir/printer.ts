import { type IRBody, type IRExpr, type IRModule } from "./types";

/**
 * Deterministic text form of the IR (used by the "ir" backend, golden tests and debugging).
 * Grammar (one expression per line): `%id = <op> <operands…> : <type>`.
 */
function formatNumber(n: number, ty: string): string {
  if (ty === "bool") return n ? "true" : "false";
  if (ty === "int") return String(n);
  if (Number.isNaN(n)) return "nan";
  if (!Number.isFinite(n)) return n > 0 ? "inf" : "-inf";
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

const ids = (a: readonly number[]) => a.map((i) => `%${i}`).join(", ");

function printExpr(e: IRExpr): string {
  switch (e.op) {
    case "const": {
      const scalarTy = e.ty === "bool" ? "bool" : e.ty === "int" ? "int" : "float";
      const vals = e.value.map((v) => formatNumber(v, scalarTy));
      return `const ${vals.length === 1 ? vals[0] : `(${vals.join(", ")})`} : ${e.ty}`;
    }
    case "param":
      return `param ${e.index} : ${e.ty}`;
    case "unary":
      return `${e.kind} %${e.a} : ${e.ty}`;
    case "binary":
      return `${e.kind} %${e.a}, %${e.b} : ${e.ty}`;
    case "intrinsic":
      return `${e.fn}(${ids(e.args)}) : ${e.ty}`;
    case "construct":
      return `construct(${ids(e.args)}) : ${e.ty}`;
    case "swizzle":
      return `swizzle %${e.src}.${e.mask} : ${e.ty}`;
    case "select":
      return `select %${e.cond} ? %${e.a} : %${e.b} : ${e.ty}`;
    case "cast":
      return `cast %${e.src} : ${e.ty}`;
    case "matmul":
      return `matmul %${e.a}, %${e.b} : ${e.ty}`;
    case "sample": {
      const parts = [`tex=%${e.tex}`, e.samp !== undefined ? `samp=%${e.samp}` : "samp=<own>", `uv=%${e.uv}`];
      if (e.lod !== undefined) parts.push(`lod=%${e.lod}`);
      if (e.ddx !== undefined) parts.push(`ddx=%${e.ddx}`, `ddy=%${e.ddy}`);
      return `sample.${e.mode} ${parts.join(" ")} : ${e.ty}`;
    }
    case "textureSize":
      return `textureSize %${e.tex} : ${e.ty}`;
    case "samplerState":
      return `sampler ${e.filter}/${e.wrap} : ${e.ty}`;
    case "deriv":
      return `${e.kind} %${e.src} : ${e.ty}`;
    case "input":
      return `input ${e.input}${e.space ? `@${e.space}` : ""} : ${e.ty}`;
    case "uniform":
      return `uniform ${e.prop} : ${e.ty}`;
    case "call":
      return `call ${e.fn}(${ids(e.args)})#${e.index} : ${e.ty}`;
    case "custom":
      return `custom ${e.block}(${ids(e.args)})#${e.index} : ${e.ty}`;
    case "engine":
      return `engine ${e.name}(${ids(e.args)}) : ${e.ty}`;
  }
}

function printBody(body: IRBody, indent: string, lines: string[]): void {
  body.exprs.forEach((e, i) => lines.push(`${indent}%${i} = ${printExpr(e)}`));
}

export function printModule(m: IRModule): string {
  const lines: string[] = [`kekenik-ir ${m.irVersion} profile=${m.profileId}`];
  for (const u of m.uniforms)
    lines.push(
      `uniform ${u.prop} "${u.property.referenceName}" : ${u.ty}${u.property.type === "color" || u.property.type === "color4" ? " [color]" : ""}`,
    );
  for (const c of m.customBlocks) {
    const targets = Object.keys(c.code).sort().join(",");
    lines.push(
      `custom ${c.id} "${c.name}"(${c.inputs.map((p) => `${p.name}: ${p.ty}`).join(", ")}) -> (${c.outputs.map((p) => `${p.name}: ${p.ty}`).join(", ")}) [${targets}]`,
    );
  }
  for (const f of m.functions) {
    lines.push(
      `fn ${f.id} "${f.name}"(${f.params.map((p) => `${p.name}: ${p.ty}`).join(", ")}) -> (${f.returns.map((p) => `${p.name}: ${p.ty}`).join(", ")}):`,
    );
    printBody(f.body, "  ", lines);
    lines.push(`  ret ${ids(f.ret)}`);
  }
  lines.push("main:");
  printBody(m.main, "  ", lines);
  for (const o of m.outputs) lines.push(`  output ${o.slot} = %${o.value} @${o.stage}`);
  return lines.join("\n") + "\n";
}
