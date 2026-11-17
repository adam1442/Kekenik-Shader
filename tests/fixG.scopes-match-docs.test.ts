import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { builtinsFor } from "../src/core/codegen/godot/data/builtins";
import { FUNCTIONS } from "../src/core/codegen/godot/data/language";

const docs = JSON.parse(readFileSync("tests/fixtures/godot-docs.json", "utf8")) as {
  spatial: Record<"global" | "vertex" | "fragment" | "light", Array<[string, string, string]>>;
  functions: string[];
};
describe("fixG.scopes-match-docs", () => {
  it("global built-ins = docs (and TAU/E/OUTPUT_IS_SRGB/CLIP_SPACE_FAR/IN_SHADOW_PASS are global)", () => {
    const names = builtinsFor("spatial", "global").map((b) => b.name);
    for (const [, , n] of docs.spatial.global) expect(names).toContain(n);
    expect(names).toContain("E");
    expect(names).not.toContain("PROJECTION_MATRIX");
  });
  for (const fn of ["vertex", "fragment", "light"] as const)
    it(`${fn}(): every documented built-in has the documented type and access`, () => {
      const tbl = builtinsFor("spatial", fn);
      for (const [access, type, name] of docs.spatial[fn]) {
        const d = tbl.find((b) => b.name === name);
        expect(d, `${fn}:${name}`).toBeTruthy();
        expect(`${d!.access} ${d!.type}`, `${fn}:${name}`).toBe(`${access} ${type}`);
      }
    });
  it("function table contains every documented built-in function; HLSL names are absent", () => {
    for (const f of docs.functions) expect(FUNCTIONS, f).toContain(f);
    for (const f of ["saturate", "frac", "lerp", "mul", "fmod", "rsqrt", "atan2"]) expect(FUNCTIONS).not.toContain(f);
  });
});
