import { compileGodot, resolveGodotOptions } from "../codegen/godot";
import { normalizeRenderer, normalizeVersion } from "../codegen/godot/data/versions";
import type { Graph } from "../graph/types";
import { targetProfiles } from "../profiles";
import type { ExportOpts, ExportTarget } from "./registry";

/** README section of the Godot export. */
export function godotReadme(graph: Graph): string {
  const tp = targetProfiles.get(graph.profileId);
  const version = normalizeVersion(graph.settings.godotVersion);
  const renderer = normalizeRenderer(graph.settings.godotRenderer);
  const L = [
    "## Godot 4",
    "",
    `Target: Godot ${version} (the file is valid unchanged on 4.3 → 4.7) · Profile: ${tp?.label ?? graph.profileId} · Renderer: ${renderer === "all" ? "All" : renderer}.`,
    "",
    "1. Copy the `.gdshader` file into your project (e.g. `res://shaders/`).",
    "2. Create a `ShaderMaterial`, set its **Shader** to the file and assign the material to a node (MeshInstance3D / Sprite2D / particles …).",
    "3. Exposed parameters appear in the material inspector with their hints (ranges, colour pickers, enum dropdowns, texture slots) and are grouped by category (`group_uniforms`).",
    "",
    "Notes",
    "- **Instance uniforms** (per-instance parameters) are NOT in the material inspector: set them on the node (*Instance Shader Parameters*) or with `set_instance_shader_parameter()`.",
    "- **Global uniforms** must be created in *Project Settings → Shader Globals* first, otherwise the shader does not compile (a default value in the shader is ignored).",
    "- **Cast shadows** is a node property (`GeometryInstance3D.cast_shadow`) and **render priority** is a material property (−128…127): neither can be set from the shader.",
    "- **Colours**: colour parameters are `source_color` (sRGB picker). HDR colours are exported as an LDR colour plus a `<name>_intensity` float; the shader multiplies them.",
    "- **Keywords**: Godot has no per-material shader keywords — keyword switches are runtime uniforms with `if` / `switch`.",
    "- **UV**: Godot's UV origin is top-left (V down). Kekenik applies no flip; check a test texture (manual checklist `uv-orientation`).",
    "- **Renderers**: `hint_normal_roughness_texture` works only in Forward+. Depth reconstruction differs in the Compatibility renderer (the exported shader contains the safe `#if CURRENT_RENDERER == RENDERER_COMPATIBILITY` branch).",
    "- **Stencil** (`stencil_mode`, Godot 4.5+, experimental): the statement is emitted only when Surface Options ▸ Stencil is on and the target is 4.5+. Reading works only in the transparent pass; use the same reference value in the writing and the reading material (manual checklist `stencil-mode`).",
  ];
  if (tp?.id === "godot.canvasitem")
    L.push(
      "- **CanvasItem**: the sprite texture is the built-in `TEXTURE` (no uniform). With *Apply modulate* on, `modulate` / `self_modulate` / vertex colour still tint the result. Overlapping screen-texture readers need a `BackBufferCopy`.",
    );
  if (tp?.family === "vfx")
    L.push(
      "- **VFX / Particles**: use the material as the draw-pass / material override of GPUParticles3D / CPUParticles3D. Soft particles read the depth texture (the material renders in the transparent pass). `shader_type particles` process shaders are out of scope.",
    );
  L.push(
    "",
    "This output was verified by Kekenik Shader's static validators — verify compilation and rendering in Godot 4 after importing.",
  );
  return L.join("\n") + "\n";
}

export const godotExportTarget: ExportTarget = {
  id: "godot",
  label: "Godot 4 (.gdshader)",
  extension: "gdshader",
  generate: (graph: Graph, opts?: ExportOpts) => {
    const r = compileGodot(graph, opts?.generatorVersion ? { generatorVersion: opts.generatorVersion } : {});
    return r.text ? [{ path: r.fileName, content: r.text, language: "gdshader" }] : [];
  },
  readmeSection: (graph) => godotReadme(graph),
  manifestExtras: (graph) => {
    const tp = targetProfiles.get(graph.profileId);
    const o = tp ? resolveGodotOptions(tp, graph.settings) : undefined;
    return {
      target: "godot",
      version: normalizeVersion(graph.settings.godotVersion),
      profile: graph.profileId,
      renderer: normalizeRenderer(graph.settings.godotRenderer),
      shaderType: o?.shaderType,
      renderMode: o?.modes ?? [],
    };
  },
};
