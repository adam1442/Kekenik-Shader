import type { ProfileProblem } from "../../profiles/types";
import { builtinFor, builtinsFor, isWritable } from "./data/builtins";
import { HINT_NAMES, INSTANCE_UNIFORM_TYPES, MAX_INSTANCE_UNIFORMS, hintByName } from "./data/hints";
import { FUNCTIONS, KEYWORDS, TYPE_NAMES, isReservedGodot } from "./data/language";
import { GLSL_LEFTOVERS, PROCESSOR_FUNCTIONS, REMOVED_IDENTIFIERS } from "./data/removed";
import { groupOf, renderModesOf } from "./data/renderModes";
import { type GodotTarget, featureAvailable } from "./data/versions";
import { GODOT_DEFINES } from "./data/builtinScopes";
import { HLSL_ISMS, checkStrict } from "./validateStrict";
import { checkStencil } from "./validateStencil";
import {
  type FnInfo,
  cleanSource,
  hintName,
  lineOf,
  parseFunctions,
  parseUniforms,
  parseVaryings,
} from "./validateText";

export interface GodotValidateCtx {
  target?: GodotTarget;
}

const err = (rule: string, message: string, line?: number): ProfileProblem => ({
  rule,
  severity: "error",
  message,
  ...(line !== undefined ? { line } : {}),
});
const warn = (rule: string, message: string, manual?: string): ProfileProblem => ({
  rule,
  severity: "warning",
  message,
  ...(manual ? { manual } : {}),
});
const GLOBAL_FNS = ["vertex", "fragment", "light"];

/** godot.shader-type + godot.render-mode. Returns the shader type (undefined when invalid). */
function checkHeader(clean: string, out: ProfileProblem[], ctx: GodotValidateCtx): string | undefined {
  const m = /^\s*shader_type\s+([A-Za-z_]\w*)\s*;/.exec(clean.replace(/^(\s*#[^\n]*\n)+/, ""));
  if (!m) {
    out.push(
      err("godot.shader-type", "The first statement must be `shader_type spatial;` or `shader_type canvas_item;`"),
    );
    return undefined;
  }
  const type = m[1]!;
  if (type !== "spatial" && type !== "canvas_item") {
    out.push(err("godot.shader-type", `Unsupported shader_type "${type}" (spatial | canvas_item)`));
    return undefined;
  }
  const rms = [...clean.matchAll(/\brender_mode\s+([^;]*);/g)];
  if (rms.length > 1)
    out.push(err("godot.render-mode", "render_mode must be ONE statement listing every mode, comma-separated"));
  const defs = renderModesOf(type);
  const groups = new Map<string, string>();
  for (const rm of rms)
    for (const mode of rm[1]!
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      const def = defs.find((d) => d.id === mode);
      const line = lineOf(clean, rm.index ?? 0);
      if (!def) {
        out.push(err("godot.render-mode", `Render mode "${mode}" is not valid for shader_type ${type}`, line));
        continue;
      }
      if (def.neverEmit)
        out.push(err("godot.render-mode", `Render mode "${mode}" is a debug aid and is never emitted`, line));
      const g = groupOf(type, mode);
      if (g && groups.has(g))
        out.push(
          err(
            "godot.render-mode",
            `Render modes "${groups.get(g)}" and "${mode}" are in the same exclusivity group (${g})`,
            line,
          ),
        );
      else if (g) groups.set(g, mode);
      if (!g && [...rms.flatMap((r) => r[1]!.split(",").map((s) => s.trim()))].filter((x) => x === mode).length > 1)
        out.push(err("godot.render-mode", `Render mode "${mode}" is listed twice`, line));
      if (def.status === "unverified-by-doc")
        out.push(warn("godot.unverified-api", `Render mode "${mode}" is unverified-by-doc`, "depth-test-inverted"));
      if (def.gate && ctx.target && !featureAvailable(def.gate, ctx.target.version))
        out.push(
          err("godot.render-mode", `Render mode "${mode}" needs a newer Godot than ${ctx.target.version}`, line),
        );
    }
  return type;
}

/** godot.builtin-access: writes only to out/inout built-ins of the current function; built-ins only inside their processor function. */
function checkBuiltins(clean: string, type: string, fns: FnInfo[], out: ProfileProblem[]): void {
  for (const f of fns) {
    const proc =
      f.name === "vertex" || f.name === "fragment" || (f.name === "light" && type === "spatial") ? f.name : undefined;
    const known = proc
      ? builtinsFor(type, proc)
      : builtinsFor(type, "vertex").concat(builtinsFor(type, "fragment"), builtinsFor(type, "light"));
    const names = new Set(known.map((k) => k.name));
    const re = /(^|[^.\w])([A-Z][A-Z0-9_]+)\b((?:\.\w+|\[[^\]]*\])*)\s*(\+\+|--|[-+*/]?=(?!=))?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.body))) {
      const name = m[2]!;
      const isBuiltinAnywhere = [
        ...builtinsFor(type, "vertex"),
        ...builtinsFor(type, "fragment"),
        ...builtinsFor(type, "light"),
      ].some((k) => k.name === name);
      if (!isBuiltinAnywhere) continue;
      const line = f.line + (f.body.slice(0, m.index).match(/\n/g)?.length ?? 0);
      const writes = !!m[4];
      if (!proc) continue; // reported as godot.builtin-out-of-scope by checkStrict
      if (!names.has(name)) {
        out.push(
          err("godot.builtin-out-of-scope", `Built-in ${name} is not available in ${proc}() of shader_type ${type} — it exists only in other processor functions (pass a varying)`, line),
        );
        continue;
      }
      const def = builtinFor(type, proc, name)!;
      if (writes && !isWritable(def.access))
        out.push(err("godot.readonly-assign", `Built-in ${name} is read-only (in) in ${proc}() — it cannot be assigned`, line));
      void clean;
    }
  }
}

/** godot.identifiers + godot.removed-identifiers. */
function checkIdentifiers(clean: string, type: string, out: ProfileProblem[]): void {
  const noPre = clean
    .split("\n")
    .map((l) => (l.trimStart().startsWith("#") ? " ".repeat(l.length) : l))
    .join("\n");
  const macros = [...clean.matchAll(/^\s*#\s*define\s+([A-Za-z_]\w*)/gm)].map((m) => m[1]!);
  const stripped = noPre
    .replace(/\b(shader_type|render_mode|stencil_mode)\b[^;]*;/g, (s) => " ".repeat(s.length))
    .replace(/\bgroup_uniforms\b[^;]*;/g, (s) => " ".repeat(s.length));
  const structs = [...stripped.matchAll(/\bstruct\s+([A-Za-z_]\w*)/g)].map((m) => m[1]!);
  const types = new Set([...TYPE_NAMES, ...structs]);
  const declared = new Set<string>(macros);
  const tok = /(\.\s*)?\b([A-Za-z_]\w*)\b/g;
  const toks: Array<{ name: string; index: number; member: boolean; called: boolean }> = [];
  let m: RegExpExecArray | null;
  while ((m = tok.exec(stripped)))
    toks.push({
      name: m[2]!,
      index: m.index + (m[1]?.length ?? 0),
      member: !!m[1],
      called: /^\s*\(/.test(stripped.slice(tok.lastIndex, tok.lastIndex + 8)),
    });
  // A file-mode Custom Function calls a function that lives in an included .gdshaderinc we cannot read: such calls are only a warning.
  const hasInclude = /^\s*#\s*include\b/m.test(clean);
  for (let i = 0; i < toks.length - 1; i++)
    if (
      types.has(toks[i]!.name) &&
      /^\s+$/.test(stripped.slice(toks[i]!.index + toks[i]!.name.length, toks[i + 1]!.index)) &&
      !toks[i]!.member &&
      !types.has(toks[i + 1]!.name) &&
      !KEYWORDS.includes(toks[i + 1]!.name)
    )
      declared.add(toks[i + 1]!.name);
  const builtins = new Set(
    [...builtinsFor(type, "vertex"), ...builtinsFor(type, "fragment"), ...builtinsFor(type, "light")].map(
      (b) => b.name,
    ),
  );
  const known = new Set<string>([
    ...TYPE_NAMES,
    ...KEYWORDS,
    ...FUNCTIONS,
    ...HINT_NAMES,
    ...builtins,
    ...declared,
    ...structs,
    ...GODOT_DEFINES,
  ]);
  const seen = new Set<string>();
  for (const t of toks) {
    if (t.member) continue;
    if (REMOVED_IDENTIFIERS[t.name] !== undefined) {
      out.push(
        err(
          "godot.removed-identifiers",
          `"${t.name}" was removed in Godot 4 — use ${REMOVED_IDENTIFIERS[t.name]}`,
          lineOf(clean, t.index),
        ),
      );
      continue;
    }
    if (!known.has(t.name) && !seen.has(t.name) && hasInclude && t.called) {
      seen.add(t.name);
      out.push(
        warn(
          "godot.identifiers",
          `Function "${t.name}" is not defined here — assumed to come from an #include file (not checked)`,
        ),
      );
      continue;
    }
    if (!known.has(t.name) && !seen.has(t.name)) {
      seen.add(t.name);
      const hint = HLSL_ISMS[t.name];
      out.push(
        err(
          t.called ? "godot.unknown-function" : "godot.unknown-identifier",
          `Unknown ${t.called ? "function" : "identifier"} "${t.name}"${hint ? ` — that is HLSL / GLSL; in Godot use ${hint}` : ""}`,
          lineOf(clean, t.index),
        ),
      );
    }
  }
}

function checkUniforms(clean: string, out: ProfileProblem[]): void {
  const us = parseUniforms(clean);
  let instances = 0;
  const indices = new Map<string, number>();
  for (const u of us) {
    if (u.defaultBeforeHints)
      out.push(err("godot.hints", `Uniform "${u.name}": the default value must come AFTER the hints`, u.line));
    for (const h of u.hints) {
      const name = hintName(h);
      const def = hintByName(name);
      if (!def) {
        out.push(err("godot.hints", `Uniform "${u.name}": unknown hint "${name}"`, u.line));
        continue;
      }
      if (!def.types.includes(u.type))
        out.push(err("godot.hints", `Uniform "${u.name}": hint ${name} is not valid on type ${u.type}`, u.line));
      if (def.args && !h.includes("("))
        out.push(err("godot.hints", `Uniform "${u.name}": hint ${name} needs arguments`, u.line));
    }
    if (u.qualifier === "global" && (u.hints.length || u.hasDefault))
      out.push(
        warn(
          "godot.hints",
          `Global uniform "${u.name}": hints / defaults are ignored — define the global in Project Settings → Shader Globals`,
        ),
      );
    if (u.qualifier === "instance") {
      instances++;
      if (u.type.startsWith("sampler") || u.array || !INSTANCE_UNIFORM_TYPES.includes(u.type))
        out.push(
          err(
            "godot.instance-uniform",
            `Instance uniform "${u.name}" must be a scalar / vector (not ${u.array ? "an array" : u.type})`,
            u.line,
          ),
        );
      for (const h of u.hints) {
        const mm = /^instance_index\(\s*(\d+)\s*\)$/.exec(h);
        if (mm) {
          const idx = Number(mm[1]);
          if (idx > 15) out.push(err("godot.instance-uniform", `instance_index(${idx}) must be 0–15`, u.line));
          if (indices.has(mm[1]!))
            out.push(
              err(
                "godot.instance-uniform",
                `Duplicate instance_index(${idx}) on "${u.name}" and "${indices.get(mm[1]!)}"`,
                u.line,
              ),
            );
          indices.set(mm[1]!, u.name as never);
        }
      }
    }
  }
  if (instances > MAX_INSTANCE_UNIFORMS)
    out.push(err("godot.instance-uniform", `${instances} instance uniforms; the maximum is ${MAX_INSTANCE_UNIFORMS}`));
}

function checkVaryings(clean: string, fns: FnInfo[], out: ProfileProblem[]): void {
  const vs = fns.find((f) => f.name === "vertex");
  const fs = fns.find((f) => f.name === "fragment");
  const ls = fns.find((f) => f.name === "light");
  for (const v of parseVaryings(clean)) {
    if (v.depth !== 0) {
      out.push(err("godot.varying", `Varying "${v.name}" must be declared at global scope`, v.line));
      continue;
    }
    const w = new RegExp(`(^|[^.\\w])${v.name}\\b(\\.\\w+)?\\s*[-+*/]?=(?!=)`);
    if (!vs || !w.test(vs.body))
      out.push(err("godot.varying", `Varying "${v.name}" is never written in vertex()`, v.line));
    if (fs && w.test(fs.body))
      out.push(err("godot.varying", `Varying "${v.name}" is written in fragment() (read-only there)`, v.line));
    if (!new RegExp(`(^|[^.\\w])${v.name}\\b`).test(`${fs?.body ?? ""}\n${ls?.body ?? ""}`))
      out.push(warn("godot.varying", `Varying "${v.name}" is never read in fragment()`));
  }
}

function checkStructure(clean: string, fns: FnInfo[], out: ProfileProblem[]): void {
  // braces
  const stack: string[] = [];
  const pair: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  let bad = false;
  for (let i = 0; i < clean.length && !bad; i++) {
    const c = clean[i]!;
    if ("([{".includes(c)) stack.push(c);
    else if (")]}".includes(c) && stack.pop() !== pair[c]) {
      out.push(err("godot.braces", `Unbalanced "${c}"`, lineOf(clean, i)));
      bad = true;
    }
  }
  if (!bad && stack.length) out.push(err("godot.braces", `Unclosed "${stack[stack.length - 1]}"`));
  // duplicates + ref collisions
  const names = new Map<string, string>();
  const claim = (name: string, kind: string, line: number): void => {
    const prev = names.get(name);
    if (prev !== undefined)
      out.push(
        err(
          prev === kind && kind !== "function"
            ? "godot.duplicates"
            : kind === "function" && prev === "function"
              ? "godot.duplicates"
              : "godot.ref-collision",
          `"${name}" is declared twice (${prev} / ${kind})`,
          line,
        ),
      );
    else names.set(name, kind);
  };
  for (const u of parseUniforms(clean)) {
    claim(u.name, "uniform", u.line);
    if (isReservedGodot(u.name))
      out.push(err("godot.ref-collision", `Uniform "${u.name}" is a reserved Godot identifier`, u.line));
  }
  for (const v of parseVaryings(clean)) if (v.depth === 0) claim(v.name, "varying", v.line);
  for (const m of clean.matchAll(/\bconst\s+[A-Za-z_]\w*\s+([A-Za-z_]\w*)/g))
    if (depthAndZero(clean, m.index ?? 0)) claim(m[1]!, "const", lineOf(clean, m.index ?? 0));
  const sigs = new Set<string>();
  for (const f of fns) {
    const sig = `${f.name}(${f.params
      .replace(/\b(in|out|inout|const)\s+/g, "")
      .split(",")
      .map((p) => p.trim().split(/\s+/)[0])
      .join(",")})`;
    if (sigs.has(sig)) out.push(err("godot.duplicates", `Function ${sig} is defined twice`, f.line));
    sigs.add(sig);
    if (PROCESSOR_FUNCTIONS.includes(f.name) && !GLOBAL_FNS.includes(f.name))
      out.push(err("godot.processor-names", `Function "${f.name}" uses a reserved processor-function name`, f.line));
    if (GLOBAL_FNS.slice(0, 2).includes(f.name) && (f.returns !== "void" || f.params !== ""))
      out.push(err("godot.processor-names", `${f.name}() must be \`void ${f.name}()\``, f.line));
    if (!PROCESSOR_FUNCTIONS.includes(f.name) && isReservedGodot(f.name))
      out.push(err("godot.processor-names", `Function "${f.name}" collides with a reserved Godot identifier`, f.line));
  }
  // GLSL leftovers
  for (const l of GLSL_LEFTOVERS) {
    const m = l.re.exec(clean);
    if (m)
      out.push(
        err("godot.glsl-leftovers", `GLSL leftover \`${l.what}\` is not valid in a .gdshader`, lineOf(clean, m.index)),
      );
  }
  // depth
  if (/hint_depth_texture/.test(clean) && !/#\s*if\s+CURRENT_RENDERER\s*==\s*RENDERER_COMPATIBILITY/.test(clean))
    out.push(
      err(
        "godot.depth-ndc",
        "hint_depth_texture is used without the Compatibility-safe NDC `#if CURRENT_RENDERER == RENDERER_COMPATIBILITY` block",
      ),
    );
}
const depthAndZero = (clean: string, i: number): boolean => {
  let d = 0;
  for (let k = 0; k < i; k++) {
    if (clean[k] === "{") d++;
    else if (clean[k] === "}") d--;
  }
  return d === 0;
};

/**
 * godot.light-stage : `light` is spatial-only in this generator, takes no parameters, must contribute through
 * `DIFFUSE_LIGHT +=` / `SPECULAR_LIGHT +=` (plain `=` would make the result depend on the light order), and must not read fragment()-only data.
 */
function checkLightStage(type: string, fns: FnInfo[], out: ProfileProblem[]): void {
  const light = fns.filter((f) => f.name === "light");
  if (light.length === 0) return;
  if (type !== "spatial")
    out.push(err("godot.light-stage", "light() is only generated for shader_type spatial", light[0]!.line));
  for (const f of light) {
    if (f.returns !== "void" || f.params !== "")
      out.push(err("godot.light-stage", "light() must be `void light()`", f.line));
    for (const m of f.body.matchAll(/(^|[^.\w])(DIFFUSE_LIGHT|SPECULAR_LIGHT)\s*(\+?=)(?!=)/g)) {
      if (m[3] === "=")
        out.push(
          err(
            "godot.light-stage",
            `${m[2]} must be accumulated with \`+=\` inside light() (it is called once per light)`,
            f.line + (f.body.slice(0, m.index).match(/\n/g)?.length ?? 0),
          ),
        );
    }
    for (const bad of ["FRONT_FACING", "SCREEN_UV", "VERTEX", "EMISSION", "AO"]) {
      if (new RegExp(`(^|[^.\\w])${bad}\\b`).test(f.body))
        out.push(err("godot.light-stage", `${bad} is a fragment() built-in and is not available in light()`, f.line));
    }
  }
}

/** All static validators over generated `.gdshader` text. Pure; every rule id is `godot.<rule>`. */
export function validateGodot(text: string, ctx: GodotValidateCtx = {}): ProfileProblem[] {
  const clean = cleanSource(text);
  const out: ProfileProblem[] = [];
  const type = checkHeader(clean, out, ctx);
  const fns = parseFunctions(clean);
  checkStructure(clean, fns, out);
  if (type) checkStencil(clean, type, ctx.target, out);
  checkUniforms(clean, out);
  checkVaryings(clean, fns, out);
  if (type) {
    checkBuiltins(clean, type, fns, out);
    checkIdentifiers(clean, type, out);
    checkLightStage(type, fns, out);
    checkStrict(clean, type, fns, out);
  }
  const unverified = [...new Set([...clean.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)].map((m) => m[1]!))].filter(
    (n) =>
      type &&
      [...builtinsFor(type, "vertex"), ...builtinsFor(type, "fragment"), ...builtinsFor(type, "light")].some(
        (b) => b.name === n && b.status === "unverified-by-doc",
      ),
  );
  if (unverified.length)
    out.push(
      warn(
        "godot.unverified-api",
        `Unverified-by-doc built-ins used: ${unverified.sort().join(", ")}`,
        "unverified-api",
      ),
    );
  return out;
}
