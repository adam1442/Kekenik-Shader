import { describe, expect, it } from "vitest";
import { parseEngineErrors } from "../src/core/engine/knownErrors";
import { exportGodot, loadSample } from "./helpers/godot";

const REPORT = `Error at line 59: Unknown identifier in expression: 'INV_PROJECTION_MATRIX'.
Error at line 63: Unknown identifier in expression: 'PROJECTION_MATRIX'.`;

describe("fixG.known-errors", () => {
  it("fixG.known-errors.user-report", () => {
    const r = parseEngineErrors(REPORT, "godot");
    expect(r.map((x) => x.line)).toEqual([59, 63]);
    expect(r[0]!.known?.id).toBe("godot.unknown-identifier");
    expect(r[0]!.known?.explain).toContain("INV_PROJECTION_MATRIX");
    expect(r[1]!.known?.rule).toBe("godot.builtin-out-of-scope");
  });
  it("fixG.known-errors.others", () => {
    expect(parseEngineErrors(`Error at line 5: Invalid arguments for the built-in function: "pow(int, float)".`)[0]!.known?.id).toBe("godot.invalid-arguments");
    expect(parseEngineErrors("Shader.shader(12) error: undeclared identifier 'GetMainLight'")[0]!.known?.id).toBe("unity.undeclared-identifier");
    expect(parseEngineErrors("unrecognized identifier 'foo'", "unity")[0]!.known?.id).toBe("unity.unrecognized-identifier");
  });
  it("fixG.known-errors.fixed-export-has-no-such-error", () => {
    // Every identifier the engine could report is absent from helper bodies in the corrected export.
    const { errors } = exportGodot(loadSample("stylized-water"), "godot.spatial", "4.7");
    expect(errors.filter((e) => e.rule === "godot.builtin-out-of-scope")).toEqual([]);
  });
});
