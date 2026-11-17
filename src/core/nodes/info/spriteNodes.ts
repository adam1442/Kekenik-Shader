import type { NodeDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { M } from "../procedural/irm";
import { floatPort } from "../procedural/ports";
import { CAT, eng, out, sceneNode } from "./common";

const spriteRectNode: NodeDef = sceneNode({
  id: "spriteRect",
  category: CAT.sprite,
  name: "Sprite Rect",
  synonyms: ["atlas rect", "sprite uv rect", "atlas region", "sprite frame uv", "sprite bounds uv"],
  description:
    "Rectangle of the sprite inside its texture / atlas, in UV units: Rect = (x, y, width, height), Offset = (x, y), Size = (width, height). Local UV = (UV − Offset) / Size — the 0…1 position INSIDE the sprite regardless of atlas packing (Size 0 gives 0). UV defaults to UV0. The preview feeds the rectangle of the loaded sprite (the current sheet frame); Unity and Godot do not expose an atlas sub-rectangle to shaders, so there it is the full rectangle (0, 0, 1, 1) — feed a Vector 4 property from a script for atlas-aware effects (flagged approximate). Any stage.",
  inputs: [{ id: "uv", name: "UV", type: T("vec2"), defaultInput: { input: "uv0" }, tag: { semantic: "uv" } }],
  outputs: [
    out("rect", "Rect", "vec4"),
    out("offset", "Offset", "vec2"),
    out("size", "Size", "vec2"),
    out("local", "Local UV", "vec2"),
  ],
  uses: ["ks.sprite.rect"],
  build: (c) => {
    const m = new M(c.b);
    const r = m.w(eng(c, "ks.sprite.rect"));
    const size = r.sw("zw");
    const safe = m.v2(m.sel(size.x.abs().lt(1e-9), 1, size.x), m.sel(size.y.abs().lt(1e-9), 1, size.y));
    const local = m.w(c.in("uv")).sub(r.sw("xy")).div(safe);
    return {
      rect: r.id,
      offset: r.sw("xy").id,
      size: size.id,
      local: m.v2(m.sel(size.x.abs().lt(1e-9), 0, local.x), m.sel(size.y.abs().lt(1e-9), 0, local.y)).id,
    };
  },
});

const spriteSizeNode: NodeDef = sceneNode({
  id: "spriteSize",
  category: CAT.sprite,
  name: "Sprite Size",
  synonyms: ["sprite pixels", "sprite dimensions", "sprite texel size", "sprite resolution", "texture size of sprite"],
  description:
    "Size of the sprite texture in PIXELS (Width, Height, Size) and Texel = (1 / width, 1 / height) in UV units (never Inf: a size of 0 gives a texel of 0). Preview: the loaded sprite sheet (frame size). Unity reads _MainTex_TexelSize (the sprite texture must be declared as _MainTex); Godot canvas_item uses TEXTURE_PIXEL_SIZE; Godot spatial has no sprite. Pixels-per-unit is NOT a shader value — use Pixels Per Unit with a property. Any stage.",
  inputs: [],
  outputs: [
    out("width", "Width", "float"),
    out("height", "Height", "float"),
    out("size", "Size", "vec2"),
    out("texel", "Texel", "vec2"),
  ],
  uses: ["ks.sprite.info"],
  build: (c) => {
    const m = new M(c.b);
    const s = m.w(eng(c, "ks.sprite.info")).sw("xy");
    const inv = (v: ReturnType<M["f"]>) => m.sel(v.gt(1e-9), m.f(1).div(m.sel(v.gt(1e-9), v, 1)), 0);
    return { width: s.x.id, height: s.y.id, size: s.id, texel: m.v2(inv(s.x), inv(s.y)).id };
  },
});

const pixelsPerUnitNode: NodeDef = sceneNode({
  id: "pixelsPerUnit",
  category: CAT.sprite,
  name: "Pixels Per Unit",
  synonyms: ["ppu", "world pixel size", "units per pixel", "pixel size in world", "pixel density"],
  description:
    "Property-backed pixels-per-unit helper: wire a Float property (the importer's PPU, default 100) into PPU. Outputs PPU (≥ 1e-6), Unit Size = world units per sprite pixel = 1 / PPU, and — with Sprite Size — the sprite's WORLD size (Size / PPU). Snap a world position to the pixel grid with floor(p · PPU + 0.5) / PPU, or snap UVs with the Pixel Perfect Snap node. Any stage.",
  inputs: [
    floatPort("ppu", "PPU", 100),
    {
      id: "size",
      name: "Size (px)",
      type: T("vec2"),
      default: [16, 16],
      tooltip: "Sprite size in pixels (e.g. Sprite Size › Size).",
    },
  ],
  outputs: [out("ppu", "PPU", "float"), out("unit", "Unit Size", "float"), out("world", "World Size", "vec2")],
  build: (c) => {
    const m = new M(c.b);
    const ppu = m.w(c.in("ppu")).max(1e-6);
    return { ppu: ppu.id, unit: m.f(1).div(ppu).id, world: m.w(c.in("size")).div(ppu).id };
  },
});

export const SPRITE_INFO_DEFS: NodeDef[] = [spriteRectNode, spriteSizeNode, pixelsPerUnitNode];
