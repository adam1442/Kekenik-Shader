import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exportGodot } from "./helpers/godot";
import { parseKShader } from "../src/core/serialization/kshader";

const files = readdirSync("public/samples").filter((f) => f.endsWith(".kshader"));
describe("fixG.corpus — every shipped sample exports to Godot without validator errors", () => {
  it("fixG.corpus.nonempty", () => expect(files.length).toBeGreaterThan(10));
  for (const f of files)
    for (const version of ["4.3", "4.7"])
      it(`${f} @ Godot ${version}`, () => {
        const g = parseKShader(readFileSync(`public/samples/${f}`, "utf8")).graph;
        const { text, errors, bundle } = exportGodot(g, undefined, version);
        const unsupported = bundle.reports.find((r) => r.id === "godot")?.ok === false && !text;
        if (unsupported) return; // diagnosed (no code emitted)
        expect(errors.map((e) => `${e.rule}${e.line ? ` L${e.line}` : ""}: ${e.message}`)).toEqual([]);
      });
});
