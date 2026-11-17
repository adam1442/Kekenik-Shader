import type { NodeDef } from "../../registry/nodeDef";
import { M } from "../procedural/irm";
import { vec2Port } from "../procedural/ports";
import { CAT, NOTE_FRAGMENT, eng, out, sceneNode } from "./common";
import { screenUvOfFragment, uvOrFragment } from "./depthIr";

const screenParamsNode: NodeDef = sceneNode({
  id: "screenParams",
  category: CAT.screen,
  name: "Screen Parameters",
  synonyms: ["render target size", "viewport size", "resolution", "screen size", "viewport aspect", "_screenparams"],
  description:
    "Size of the render target the shader draws into, in PIXELS: Width, Height, Size (vec2), Texel = (1 / width, 1 / height) and Aspect = width / height (viewport aspect). Unity's _ScreenParams.zw is 1 + 1/size — this node always returns the true reciprocal. In the preview it is the viewport's drawing-buffer size (affected by the device pixel ratio). Any stage.",
  inputs: [],
  outputs: [
    out("width", "Width", "float"),
    out("height", "Height", "float"),
    out("size", "Size", "vec2"),
    out("texel", "Texel", "vec2"),
    out("aspect", "Aspect", "float"),
  ],
  uses: ["ks.screen.params"],
  build: (c) => {
    const m = new M(c.b);
    const p = m.w(eng(c, "ks.screen.params"));
    return {
      width: p.x.id,
      height: p.y.id,
      size: p.sw("xy").id,
      texel: p.sw("zw").id,
      aspect: p.x.div(p.y.max(1e-6)).id,
    };
  },
});

const screenUvNode: NodeDef = sceneNode({
  id: "screenUv",
  category: CAT.screen,
  name: "Screen Pixels",
  synonyms: [
    "screen pixel coordinates",
    "pixel coordinates",
    "pixel position",
    "screen tiled uv",
    "fragment coordinates",
  ],
  description:
    "This fragment's position on the screen, several ways. UV = 0…1, (0,0) bottom-left, +Y up. Pixel = UV · render-target size (pixel coordinates, bottom-left origin; pixel CENTRES are at .5). Centered = −1…1 with x multiplied by the aspect ratio (so circles stay round). Tiled = fract(UV · Tiling · (aspect, 1) when Square cells is on). Computed from the clip position (perspective divide), so it is correct for orthographic cameras too. FRAGMENT-ONLY.",
  inputs: [vec2Port("tiling", "Tiling", [8, 8])],
  outputs: [
    out("uv", "UV", "vec2"),
    out("pixel", "Pixel", "vec2"),
    out("centered", "Centered", "vec2"),
    out("tiled", "Tiled", "vec2"),
  ],
  params: [{ id: "square", label: "Square cells", control: "bool", default: true }],
  stage: "fragment",
  uses: ["ks.screen.params"],
  note: NOTE_FRAGMENT,
  build: (c) => {
    const m = new M(c.b);
    const uv = screenUvOfFragment(c, m);
    const sp = m.w(eng(c, "ks.screen.params"));
    const aspect = sp.x.div(sp.y.max(1e-6));
    const tiling = m.w(c.in("tiling"));
    const t = c.param<boolean>("square") ? m.v2(tiling.x.mul(aspect), tiling.y) : tiling;
    return {
      uv: uv.id,
      pixel: uv.mul(sp.sw("xy")).id,
      centered: m.v2(uv.x.mul(2).sub(1).mul(aspect), uv.y.mul(2).sub(1)).id,
      tiled: uv.mul(t).fract().id,
    };
  },
});

const sceneNormalsNode: NodeDef = sceneNode({
  id: "sceneNormals",
  category: CAT.screen,
  name: "Scene Normals",
  synonyms: ["normals texture", "depth normals", "screen normals", "normal roughness texture", "gbuffer normals"],
  description:
    "World-space normal of the opaque scene at a screen UV (0…1, bottom-left; default = this fragment's screen UV). ENGINE-ONLY and flagged: Unity URP needs a normals pre-pass (ScriptableRenderPassInput.Normal — enabled by SSAO / a Renderer Feature) and reads it through DeclareNormalsTexture.hlsl; Godot 4 (Forward+) reads normal_roughness_texture (hint_normal_roughness_texture), whose normals are VIEW-space and are rotated to world space here. Unavailable on GLSL / WGSL / HLSL (no pipeline textures). FRAGMENT-ONLY.",
  inputs: [vec2Port("uv", "UV", [0.5, 0.5], "Unconnected = this fragment's screen UV.")],
  outputs: [out("out", "Normal", "vec3")],
  stage: "fragment",
  capabilities: ["normalsTexture"],
  uses: ["ks.screen.sceneNormals"],
  note: NOTE_FRAGMENT,
  build: (c) => {
    const m = new M(c.b);
    const uv = uvOrFragment(c, m);
    return { out: eng(c, "ks.screen.sceneNormals", [uv.id]) };
  },
});

export const SCREEN_INFO_DEFS: NodeDef[] = [screenParamsNode, screenUvNode, sceneNormalsNode];
