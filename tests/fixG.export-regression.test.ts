import { describe, expect, it } from "vitest";
import { exportGodot, loadSample, rules, errorsOf } from "./helpers/godot";

/** The exact error the user reported (Godot 4.7, Stylized_Water_Gerstner_Foam_Refraction). */
const USER_ERROR = ["Error at line 59: Unknown identifier in expression: 'INV_PROJECTION_MATRIX'.", "Error at line 63: Unknown identifier in expression: 'PROJECTION_MATRIX'."];

describe("fixG.e7 — built-ins inside helper functions", () => {
  it("fixG.e7.water-sample: no helper function reads a non-global built-in", () => {
    const { text, errors } = exportGodot(loadSample("stylized-water"), "godot.spatial", "4.7");
    expect(text).toContain("shader_type spatial");
    expect(errors, JSON.stringify(errors, null, 1)).toEqual([]);
    // every function except vertex()/fragment()/light() is free of processor-only identifiers
    const helpers = [...text.matchAll(/^(?:void|float|vec[234]|mat[234]|int|bool)\s+(\w+)\s*\([^)]*\)\s*\{([\s\S]*?)^\}/gm)].filter((m) => !["vertex", "fragment", "light"].includes(m[1]!));
    expect(helpers.length).toBeGreaterThan(0);
    for (const h of helpers) expect(h[2]!, `helper ${h[1]}`).not.toMatch(/\b(INV_PROJECTION_MATRIX|PROJECTION_MATRIX|VIEW_MATRIX|INV_VIEW_MATRIX|VIEWPORT_SIZE|SCREEN_UV|FRAGCOORD)\b/);
    expect(text).toMatch(/ks_camera_params\(mat4 \w+, mat4 \w+\)/);
  });

  it("fixG.e7.user-error-fixture: the reported lines 59 / 63 are not reproduced", () => {
    const { text } = exportGodot(loadSample("stylized-water"), "godot.spatial", "4.7");
    const lines = text.split("\n");
    for (const msg of USER_ERROR) {
      const [, n, id] = /line (\d+): .*'(\w+)'/.exec(msg)!;
      const line = lines[Number(n) - 1] ?? "";
      // a processor built-in on that line is only legal when it sits inside vertex()/fragment()
      const before = lines.slice(0, Number(n)).join("\n");
      const lastFn = [...before.matchAll(/^(?:void|float|vec[234]|mat[234]|int|bool)\s+(\w+)\s*\(/gm)].pop()?.[1];
      if (line.includes(id!)) expect(["vertex", "fragment", "light"]).toContain(lastFn);
    }
  });

  it("fixG.e7.negative-exact-bug: validator catches the original pattern", () => {
    const bad = `shader_type spatial;
vec4 ks_camera_params() {
  vec4 a = INV_PROJECTION_MATRIX * vec4(0.0, 0.0, 1.0, 1.0);
  float ortho = step(0.5, PROJECTION_MATRIX[3][3]);
  return vec4(a.xy, ortho, 1.0);
}
void fragment() {
  ALBEDO = ks_camera_params().xyz;
}
`;
    const errs = errorsOf(bad).filter((p) => p.rule === "godot.builtin-out-of-scope");
    expect(errs.map((e) => e.line)).toEqual([3, 4]);
    expect(errs[0]!.message).toContain("INV_PROJECTION_MATRIX");
    expect(errs[0]!.message).toMatch(/vertex\(\) \/ fragment\(\)/);
  });
});

describe("fixG.validator — negative tests", () => {
  const wrap = (body: string, head = "") => `shader_type spatial;\n${head}\nvoid fragment() {\n${body}\n}\n`;
  it("fixG.validator.assign-to-in", () => expect(rules(wrap("  UV = vec2(0.0);"))).toContain("godot.readonly-assign"));
  it("fixG.validator.hlsl-saturate", () => expect(rules(wrap("  ALBEDO = vec3(saturate(0.5));"))).toContain("godot.unknown-function"));
  it("fixG.validator.hlsl-others", () => {
    for (const f of ["frac", "lerp", "mul", "fmod", "rsqrt", "atan2"]) expect(rules(wrap(`  float a = ${f}(1.0, 2.0);`)), f).toContain("godot.unknown-function");
  });
  it("fixG.validator.int-float", () => {
    expect(rules(wrap("  float a = 1 + 1.0;"))).toContain("godot.int-float-mix");
    expect(rules(wrap("  float a = 1;"))).toContain("godot.int-float-mix");
    expect(rules(wrap("  float x = 2.0; float a = pow(2, x);"))).toContain("godot.int-float-mix");
    expect(rules(wrap("  float x = 2.0; float a = max(x, 1);"))).toContain("godot.int-float-mix");
    expect(rules(wrap("  float x = 2.0; float a = x * 2;"))).toContain("godot.int-float-mix");
  });
  it("fixG.validator.int-float-ok", () => {
    const ok = wrap("  float x = 2.0; float a = pow(2.0, x) + x * 2.0; int k = 3; k += 1; vec3 v = vec3(1, 0, 0); ALBEDO = v * a + float(k);");
    expect(errorsOf(ok)).toEqual([]);
  });
  it("fixG.validator.removed-builtin", () => {
    expect(rules(wrap("  vec4 c = texture(SCREEN_TEXTURE, SCREEN_UV);"))).toContain("godot.removed-identifiers");
    expect(rules(wrap("  float d = texture(DEPTH_TEXTURE, SCREEN_UV).r;"))).toContain("godot.removed-identifiers");
  });
  it("fixG.validator.canvas-item-projection", () => {
    const src = "shader_type canvas_item;\nvoid fragment() {\n  vec4 p = PROJECTION_MATRIX * vec4(0.0, 0.0, 0.0, 1.0);\n  COLOR = p;\n}\n";
    expect(rules(src).some((r) => r === "godot.builtin-out-of-scope" || r === "godot.unknown-identifier")).toBe(true);
  });
  it("fixG.validator.vertex-only-in-fragment", () => expect(rules(wrap("  MODELVIEW_MATRIX = mat4(1.0);"))).toContain("godot.builtin-out-of-scope"));
  it("fixG.validator.global-ok-in-helper", () => {
    const ok = wrap("  ALBEDO = vec3(h());", "float h() { return TIME + PI + TAU + E; }");
    expect(errorsOf(ok)).toEqual([]);
  });
  it("fixG.validator.arity", () => expect(rules(wrap("  float a = clamp(1.0, 0.0);"))).toContain("godot.arity"));
  it("fixG.validator.user-fn-arity-and-type", () => {
    expect(rules(wrap("  float a = f(1.0, 2.0);", "float f(float x) { return x; }"))).toContain("godot.arity");
    expect(rules(wrap("  float a = f(1);", "float f(float x) { return x; }"))).toContain("godot.int-float-mix");
  });
  it("fixG.validator.varying-int-needs-flat", () => {
    const src = (q: string) => `shader_type spatial;\nvarying ${q}int v_i;\nvoid vertex() { v_i = 1; }\nvoid fragment() { ALBEDO = vec3(float(v_i)); }\n`;
    expect(rules(src(""))).toContain("godot.varying-int-needs-flat");
    expect(rules(src("flat "))).not.toContain("godot.varying-int-needs-flat");
  });
  it("fixG.validator.bad-hint", () => expect(rules("shader_type spatial;\nuniform float c : source_color;\nvoid fragment() {}\n").length).toBeGreaterThan(0));
  it("fixG.validator.bad-render-mode", () => expect(rules("shader_type spatial;\nrender_mode blend_foo;\nvoid fragment() {}\n")).toContain("godot.render-mode"));
  it("fixG.validator.reserved-name", () => expect(rules(wrap("  float vec3 = 1.0;")).length).toBeGreaterThan(0));
});
