import type * as THREE from "three";
import { type CompileResult, type Diagnostic, type Graph, type MaterialValues, effectiveProperties } from "@/core";
import { compileProgram } from "@/webgl/program";
import { getGl } from "@/webgl/context";
import { patchSoft, patchSurface, stripGlslComments } from "../logic/glslPatch";
import { mapGpuErrors } from "../logic/errorMap";
import { type MaterialSettings, ShaderBinding } from "./shaderBinding";
import { faceSideOf, previewBlendOf } from "./surfaceState";

export interface SubmitOptions {
  /** Wrap the shader (compiled with `surface: "preview"`) in the preview lighting prelude. */
  lit: boolean;
  /** Write depth for transparent materials. */
  depthWrite: boolean;
  /** Fade the fragment against the opaque scene depth (profile setting `softParticles`, VFX mode only). */
  soft?: boolean;
  texture: (p: import("@/core").Property) => THREE.Texture | null;
  /** Material instance values (property id → value) that override the graph defaults. */
  values?: MaterialValues;
}

type SubmitKind = "swapped" | "uniforms" | "error" | "empty";

export interface SubmitOutcome {
  kind: SubmitKind;
  ms: number;
  message: string;
  /** GPU compile errors mapped onto graph nodes. */
  diagnostics: Diagnostic[];
}

/** Material settings that live in the graph (profile settings). */
function materialSettingsOf(graph: Graph | null, depthWrite: boolean, soft = false): MaterialSettings {
  return { blend: previewBlendOf(graph?.settings.blend), side: faceSideOf(graph), depthWrite, soft };
}

/**
 * Owns the shader currently shown: validates new GLSL on the real driver BEFORE swapping, keeps the last good shader
 * when validation fails, and turns property-only edits into uniform updates (no recompile).
 */
export class ShaderHost {
  binding: ShaderBinding | null = null;
  /** GPU programs created (the "compile counter"). */
  programs = 0;
  uniformUpdates = 0;
  private key = "";

  submit(result: CompileResult | null, graph: Graph | null, o: SubmitOptions): SubmitOutcome {
    const t0 = performance.now();
    const done = (kind: SubmitKind, message = "", diagnostics: Diagnostic[] = []): SubmitOutcome => ({
      kind,
      ms: performance.now() - t0,
      message,
      diagnostics,
    });
    if (!result || !graph) return done("empty");
    const vert = result.files.find((f) => f.path === "shader.vert")?.content;
    const frag = result.files.find((f) => f.path === "shader.frag")?.content;
    if (!result.ok || !vert || !frag) {
      const first = result.diagnostics.find((d) => d.severity === "error");
      return done("error", first ? first.message : "The graph produced no shader", []);
    }
    let vs = vert;
    let fs = frag;
    const settings = materialSettingsOf(graph, o.depthWrite, o.soft === true);
    if (settings.soft) {
      const soft = patchSoft(fs, settings.blend === "premultiplied");
      if (!soft) return done("error", "Soft particles could not wrap this shader (no main function)");
      fs = soft;
    }
    if (o.lit) {
      const p = patchSurface(vs, fs);
      if (!p)
        return done(
          "error",
          "The preview surface wrapper could not wrap this shader (unexpected vertex output or no surface contract)",
        );
      ({ vs, fs } = p);
    }
    const key = `${stripGlslComments(vs)}\u0000${stripGlslComments(fs)}\u0000${o.lit}|${settings.blend}|${settings.side}|${settings.depthWrite}|${settings.soft}`;
    if (this.binding && key === this.key) {
      this.binding.updateBindings(result.uniformBindings ?? []);
      this.binding.setProperties(effectiveProperties(graph.properties, o.values), o.texture, o.values);
      this.uniformUpdates++;
      return done("uniforms");
    }
    const h = getGl();
    if (!h) return done("error", "WebGL2 is not available in this browser");
    const check = compileProgram(h.gl, vs, fs);
    if (check.program) h.gl.deleteProgram(check.program);
    if (!check.ok) {
      const diags = mapGpuErrors(check.log, result.sourceLines);
      return done("error", diags[0]?.message ?? "GPU compile failed", diags);
    }
    const next = new ShaderBinding(vs, fs, result.uniformBindings ?? [], settings, o.lit);
    next.setProperties(effectiveProperties(graph.properties, o.values), o.texture, o.values);
    this.binding?.dispose();
    this.binding = next;
    this.key = key;
    this.programs++;
    return done("swapped");
  }

  dispose(): void {
    this.binding?.dispose();
    this.binding = null;
    this.key = "";
  }
}
