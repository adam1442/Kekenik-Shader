/**
 * Engine-error feedback loop: regex → explanation + suggested fix for messages that Godot / Unity print when they compile an exported shader.
 * `parseEngineErrors` extracts `line N` references; the caller (Export dialog "Paste engine error") maps a line to the originating graph node
 * through the code → node source map (`lineToNode`). Pure functions; the user's own report is a test fixture (tests/fixG.known-errors.test.ts).
 */
export type EngineId = "godot" | "unity";
export interface KnownError {
  id: string;
  engine: EngineId;
  pattern: RegExp;
  /** Explanation (English; `{1}` = first capture group). */
  explain: string;
  fix: string;
  /** Related validator rule of this project (the static validator should have caught it before the engine did). */
  rule?: string;
}

export const KNOWN_ERRORS: readonly KnownError[] = [
  {
    id: "godot.unknown-identifier",
    engine: "godot",
    pattern: /Unknown identifier in expression: '([^']+)'/i,
    explain:
      "'{1}' is not visible at this point. Built-ins such as PROJECTION_MATRIX, INV_PROJECTION_MATRIX, VIEW_MATRIX, VERTEX, UV, SCREEN_UV … exist only inside vertex() / fragment() / light() (each with its own list); a helper function or global initializer cannot read them. Only TIME, PI, TAU, E, OUTPUT_IS_SRGB, CLIP_SPACE_FAR and IN_SHADOW_PASS are global.",
    fix: "Re-export with the current Kekenik Shader (engine helpers now receive built-ins as parameters). If you edited the file by hand, pass the built-in into the helper as an argument or through a varying. In canvas_item shaders 3D matrices do not exist at all — use a Spatial profile.",
    rule: "godot.builtin-out-of-scope",
  },
  {
    id: "godot.invalid-arguments",
    engine: "godot",
    pattern: /Invalid arguments for the built-in function: "([^"]+)"/i,
    explain:
      "No overload of {1} matches the argument types. Godot has no implicit int ↔ float conversion: pow(2, x), max(x, 1) or mix(a, b, 1) fail when a literal is an int.",
    fix: "Write float literals with a decimal point (2.0), wrap integer variables in float(), and check the argument count.",
    rule: "godot.int-float-mix",
  },
  {
    id: "godot.int-float",
    engine: "godot",
    pattern: /Invalid (?:operands to operator|assignment of type|argument type)[^.\n]*'(int|float|uint)'[^.\n]*'(int|float|uint)'/i,
    explain: "An int and a float were mixed ('{1}' / '{2}'). Godot's shader language never converts between them implicitly.",
    fix: "Use 1.0 instead of 1 (or float(i) / int(f)).",
    rule: "godot.int-float-mix",
  },
  {
    id: "godot.hint-type",
    engine: "godot",
    pattern: /(?:Unknown|Invalid|Unexpected)[^\n]*hint[^\n]*'?(source_color|hint_\w+|filter_\w+|repeat_\w+)'?/i,
    explain: "The uniform hint '{1}' is not valid for this uniform type or this Godot version (source_color is for vec3 / vec4 / sampler2D, hint_range for float / int …).",
    fix: "Pick the Godot version / renderer that supports the hint, or remove the hint on that property.",
    rule: "godot.hints",
  },
  {
    id: "godot.unknown-function",
    engine: "godot",
    pattern: /(?:No matching function|Unknown function|Function '?([A-Za-z_]\w*)'? (?:is )?not (?:found|defined))/i,
    explain: "A function name does not exist in Godot's shading language (HLSL names such as frac / lerp / saturate / mul / fmod are not valid).",
    fix: "Use fract / mix / clamp(x, 0.0, 1.0) / the * operator / mod.",
    rule: "godot.unknown-function",
  },
  {
    id: "godot.removed-builtin",
    engine: "godot",
    pattern: /\b(SCREEN_TEXTURE|DEPTH_TEXTURE|NORMAL_ROUGHNESS_TEXTURE)\b/,
    explain: "{1} was removed in Godot 4.",
    fix: "Declare `uniform sampler2D tex : hint_screen_texture;` (hint_depth_texture / hint_normal_roughness_texture) and sample it.",
    rule: "godot.removed-identifiers",
  },
  {
    id: "unity.undeclared-identifier",
    engine: "unity",
    pattern: /undeclared identifier '?([A-Za-z_]\w*)'?/i,
    explain: "'{1}' is not declared in this HLSL scope: a missing #include, a function used before its definition, or a name that only exists in another URP version.",
    fix: "Check the exported file's #include lines and the Unity / URP version chosen in the Export dialog.",
  },
  {
    id: "unity.unrecognized-identifier",
    engine: "unity",
    pattern: /unrecognized identifier '?([A-Za-z_]\w*)'?/i,
    explain: "'{1}' is unknown to the HLSL compiler (typo, missing include or an API of a newer URP).",
    fix: "Re-export for the Unity version you use; if it persists send the message back so the mapping can be fixed.",
  },
];

export interface EngineErrorLine {
  raw: string;
  /** 1-based line of the generated file, when the message has one. */
  line?: number;
  known?: { id: string; explain: string; fix: string; rule?: string };
}

const fill = (t: string, m: RegExpMatchArray): string => t.replace(/\{(\d)\}/g, (_x, i: string) => m[Number(i)] ?? "?");

/** Split pasted engine output into messages; recognise each against the table. */
export function parseEngineErrors(text: string, engine?: EngineId): EngineErrorLine[] {
  const out: EngineErrorLine[] = [];
  for (const raw of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const ln = /(?:\bline\s+|\(|:)(\d{1,6})(?:\)|:|\b)/i.exec(raw);
    const entry: EngineErrorLine = { raw, ...(ln ? { line: Number(ln[1]) } : {}) };
    for (const k of KNOWN_ERRORS) {
      if (engine && k.engine !== engine) continue;
      const m = raw.match(k.pattern);
      if (m) {
        entry.known = { id: k.id, explain: fill(k.explain, m), fix: k.fix, ...(k.rule ? { rule: k.rule } : {}) };
        break;
      }
    }
    out.push(entry);
  }
  return out;
}
