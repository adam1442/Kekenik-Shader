/** Manual Godot checklist (user-run, "static-only / manual"). Every [K] item the generator emits is listed here by id. */
interface ManualCheck {
  id: string;
  title: string;
  /** What to do in Godot. */
  steps: string;
}
const GODOT_MANUAL_CHECKS: readonly ManualCheck[] = [
  {
    id: "import",
    title: ".gdshader imports in 4.3 and 4.7 without errors",
    steps:
      "Copy the file into a project, assign it to a ShaderMaterial; the Shader editor / Output panel must show no errors.",
  },
  {
    id: "inspector",
    title: "ShaderMaterial inspector: hints, groups, ranges, pickers, texture slots, defaults",
    steps:
      "Compare every uniform with parameters.json (range sliders, colour pickers, enum dropdowns, texture slots, group headers).",
  },
  {
    id: "hdr",
    title: "HDR colour + intensity looks identical to the Kekenik preview",
    steps: "Set a colour above 1.0 in Kekenik; the exported <name> colour × <name>_intensity must match.",
  },
  {
    id: "color-default",
    title: "source_color default conversion [K]",
    steps:
      "A linear colour default is exported as its sRGB equivalent so the shader sees the graph's linear value; confirm the material shows the same colour as the preview.",
  },
  {
    id: "renderers",
    title: "Spatial lit under Forward+, Mobile and Compatibility with lights and shadows",
    steps: "Switch the project renderer; the surface must light and receive shadows in all three.",
  },
  {
    id: "blend",
    title: "Blend modes Alpha / Additive / Premultiply / Multiply / Subtract",
    steps: "Set Blend Mode in Kekenik, re-export, compare against the preview.",
  },
  {
    id: "alpha-clip",
    title: "Alpha Clip renders in the opaque pass and discards correctly [K]",
    steps: "ALPHA_SCISSOR_THRESHOLD + ALPHA with blend Opaque: edges are cut, the object sorts like an opaque mesh.",
  },
  {
    id: "double-sided",
    title: "Double-sided back-face normals look right [K]",
    steps: "cull_disabled: back faces are lit with flipped normals automatically.",
  },
  {
    id: "shadows-disabled",
    title: "shadows_disabled stops receiving shadows",
    steps: "Turn Receive Shadows off; the surface must not show shadows (it can still cast them).",
  },
  {
    id: "canvasitem",
    title: "CanvasItem on Sprite2D with Light2D + normal map",
    steps: "unshaded ignores lights; modulate / self_modulate still tint (Apply modulate on).",
  },
  {
    id: "canvas-vertex-units",
    title: "CanvasItem VERTEX units are pixels [K]",
    steps: "A positionOS offset of (10, 0) moves the sprite by 10 pixels.",
  },
  {
    id: "uv-orientation",
    title: "UV orientation of a test texture matches the preview [K]",
    steps: "Godot UV origin is top-left, V down. No flip is applied; a textured mesh must look right-way-up.",
  },
  {
    id: "instance-uniforms",
    title: "instance uniforms appear on the node and change per instance",
    steps: "They show under Instance Shader Parameters of the node, NOT in the material inspector.",
  },
  {
    id: "global-uniforms",
    title: "global uniform created in Shader Globals works",
    steps: "Create the global in Project Settings → Shader Globals; compilation fails without it.",
  },
  {
    id: "soft-particles",
    title: "Soft particles with the depth texture on Forward+ and Compatibility",
    steps: "Particles fade near opaque geometry; Compatibility uses the NDC #if branch.",
  },
  { id: "billboard", title: "Billboard option [K]", steps: "MODELVIEW_MATRIX override makes quads face the camera." },
  {
    id: "keyword-runtime",
    title: "Keyword switches are runtime uniforms [K]",
    steps: "Boolean / enum keywords become int uniforms and runtime branches.",
  },
  {
    id: "unverified-api",
    title: "Unverified API names (engine templates)",
    steps: "Every identifier tagged unverified-by-doc in the generated file compiles in your Godot version.",
  },
  {
    id: "ao-light-affect",
    title: "AO_LIGHT_AFFECT [K]",
    steps: "Only emitted when the option is non-zero; check it compiles.",
  },
  {
    id: "native-blocks",
    title: "Godot-native blocks SPECULAR / RIM / RIM_TINT and their built-in defaults [K]",
    steps:
      "Connect Specular / Rim / Rim Tint on a Spatial graph; the highlights / rim light respond. Values equal to the built-in default (SPECULAR 0.5, RIM 0.0, RIM_TINT 0.5) are not written — confirm those defaults in your Godot version.",
  },
  {
    id: "scene-intrinsics",
    title: "Scene Depth / Scene Color / Scene Normals nodes (engine intrinsics with arguments) [K]",
    steps:
      "Spatial graph with a Scene Depth node (Forward+ or Mobile): it must compile; the generated ks_scene_depth(uv) helper reads kek_depth_texture (hint_depth_texture). In the Compatibility renderer the raw depth is standard-Z (not converted). Repeat with Scene Color (hint_screen_texture); canvas_item correctly reports Scene Depth as unsupported.",
  },
  {
    id: "light-stage",
    title: "Custom light() stage [K]",
    steps:
      "Spatial graph, Surface Options ▸ Custom light() on, connect Diffuse Light (e.g. a toon ramp of N·L × Attenuation × Light Color / PI) and add a DirectionalLight3D + an OmniLight3D: the shader compiles, DIFFUSE_LIGHT += is accumulated per light, shadows still darken it through ATTENUATION. Check LIGHT / LIGHT_COLOR / ATTENUATION spellings and that LIGHT is view space.",
  },
  {
    id: "function-builtins",
    title: "Subgraph functions reading built-in inputs (hidden parameters) [K]",
    steps:
      "A Subgraph that reads UV / Normal / View Direction / Position compiles on Godot: the function signature gains hidden parameters (kek_in_*) and every call site passes the value from vertex() / fragment(). The result must equal the same nodes placed outside the subgraph.",
  },
  {
    id: "stencil-mode",
    title: "stencil_mode (Godot 4.5+, experimental) [K]",
    steps:
      "Spatial graph, target 4.5+, Surface Options ▸ Stencil = Write (reference 1, compare Always): the file has `stencil_mode write, compare_always, 1;` after render_mode and compiles. A second material (Next Pass, transparent blend, Stencil = Read, compare Not Equal, reference 1) draws only where the first did not write. Switching the target to 4.3 / 4.4 removes the statement and shows a warning. Reading in an opaque material must be refused / ignored by the engine (the generator warns).",
  },
  {
    id: "depth-test-inverted",
    title: "depth_test_inverted needs 4.5+ [K]",
    steps: "Greater / Greater Equal depth tests export depth_test_inverted.",
  },
];
export const GODOT_MANUAL_CHECK_IDS: readonly string[] = GODOT_MANUAL_CHECKS.map((c) => c.id);

export {};
