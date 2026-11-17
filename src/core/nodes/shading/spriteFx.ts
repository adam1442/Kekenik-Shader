import type { NodeDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { enumParam } from "../kit";
import { M, type V } from "../procedural/irm";
import { hash21 } from "../procedural/hash";
import { floatPort, outPort, vec2Port } from "../procedural/ports";
import { SAMPLING_PARAM, colorPort, fetch, lodPort, rgbPort, texPort, uvPort } from "../visual/common";
import { TAU, edge, noteAll, shNode, unit } from "./common";

/** 2D sprite / screen effects. UV origin bottom-left, V up, angles in degrees (counter-clockwise), colours are used as given. */

const OUTLINE_SAMPLES = [4, 8, 16] as const;

const outlineNode: NodeDef = shNode({
  id: "spriteOutline",
  category: "Sprite/Effects",
  name: "Outline 2D",
  synonyms: ["2d outline", "sprite outline", "alpha outline", "silhouette outline", "outline sprite"],
  description:
    "Outline OUTSIDE the sprite silhouette from the alpha channel. Neighbour alpha is sampled on a ring of Samples (4 / 8 / 16) directions at Thickness: in TEXELS (Euclidean distance, 1 = one texel of the texture — needs the texture size) or in UV units. cover = saturate(max(neighbour alpha) − sprite alpha); outline alpha = Outline.a · cover; result alpha = a + outline alpha (≤ 1) and RGB = (sprite.rgb · a + Outline.rgb · outline alpha) / result alpha — straight-alpha 'sprite over outline'. Thickness 0 returns the sprite unchanged; the sprite pixels are never altered where alpha = 1. Gaps thinner than the ring are bridged at most up to Thickness; use Samples 16 for thickness > 3 texels. The texture needs transparent padding ≥ Thickness or the outline is clipped at the border (wrap Clamp).",
  inputs: [
    texPort("tex", "Texture"),
    uvPort(),
    colorPort("color", "Outline Color", [0, 0, 0, 1]),
    floatPort("thickness", "Thickness", 1),
    lodPort(0),
  ],
  outputs: [{ id: "rgba", name: "RGBA", type: T("color4") }, outPort("mask", "Outline Mask", "float")],
  params: [
    enumParam(
      "unit",
      "Thickness unit",
      [
        ["texels", "Texels"],
        ["uv", "UV"],
      ],
      "texels",
    ),
    enumParam(
      "samples",
      "Samples",
      OUTLINE_SAMPLES.map((n) => [String(n), String(n)] as [string, string]),
      "8",
    ),
    SAMPLING_PARAM,
  ],
  targetNotes: noteAll("N + 1 texture fetches per pixel. Implicit LOD (fragment) by default."),
  build: (c) => {
    const m = new M(c.b);
    const tex = c.in("tex");
    const uv = m.w(c.in("uv"));
    const n = Number(c.param<string>("samples")) || 8;
    const t = fetch(c, m, tex, uv);
    const a0 = t.w;
    let step: V = m.k("vec2", 1, 1);
    if (c.param<string>("unit") === "texels") {
      const size = m.w(c.b.textureSize(tex));
      step = m.v2(
        m.sel(size.x.gt(0), m.f(1).div(m.sel(size.x.gt(0), size.x, 1)), 0),
        m.sel(size.y.gt(0), m.f(1).div(m.sel(size.y.gt(0), size.y, 1)), 0),
      );
    }
    const th = m.w(c.in("thickness")).max(0);
    let maxA: V = a0;
    for (let i = 0; i < n; i++) {
      const ang = (TAU * i) / n;
      maxA = maxA.max(fetch(c, m, tex, uv.add(step.mul(m.v2(Math.cos(ang), Math.sin(ang))).mul(th))).w);
    }
    const oc = m.w(c.in("color"));
    const la = oc.w.saturate().mul(maxA.sub(a0).saturate());
    const outA = a0.add(la);
    const rgb = m.sel(
      outA.gt(1e-6),
      t
        .sw("xyz")
        .mul(a0)
        .add(oc.sw("xyz").mul(la))
        .div(m.sel(outA.gt(1e-6), outA, 1)),
      oc.sw("xyz"),
    );
    return { rgba: m.vec("vec4", rgb, outA).id, mask: la.id };
  },
});

const pixelSnapNode: NodeDef = shNode({
  id: "pixelSnap",
  category: "Sprite/Effects",
  name: "Pixel Perfect Snap",
  synonyms: ["pixel perfect", "texel snap", "pixel art snap", "retro pixelation"],
  description:
    "Snaps UVs to the centre (or corner) of a texel grid so pixel art stays crisp under any scale / rotation. Resolution = the grid size in pixels per axis (texture size for a 1:1 sprite; ≥ 1, clamped), in UV space (0…1 spans the whole grid, origin bottom-left). Cell = floor(UV · Resolution); UV' = (Cell + 0.5) / Resolution (Centre) or Cell / Resolution (Corner). A UV exactly on a cell border belongs to the upper cell; with Clamp Edge the cell index is limited to 0…Resolution − 1 so UV = 1.0 stays inside the texture. Use a Point-filtered texture. Texel = the integer cell as floats.",
  inputs: [uvPort(), vec2Port("resolution", "Resolution", [64, 64], "Pixels per axis of the snapping grid (≥ 1).")],
  outputs: [outPort("uv", "UV", "vec2"), outPort("texel", "Texel", "vec2")],
  params: [
    enumParam(
      "anchor",
      "Snap to",
      [
        ["center", "Texel centre"],
        ["corner", "Texel corner"],
      ],
      "center",
    ),
    { id: "clampEdge", label: "Clamp edge", control: "bool", default: true },
  ],
  targetNotes: noteAll(
    "UV-space snapping. For world-space pixel snapping of a position, feed position·PPU (pixels per unit) as the UV input and Resolution 1.",
  ),
  build: (c) => {
    const m = new M(c.b);
    const res = m.w(c.in("resolution")).max(1);
    let cell = m.w(c.in("uv")).mul(res).floor();
    if (c.param<boolean>("clampEdge")) cell = cell.clamp(0, 1e30).min(res.sub(1));
    const uv = cell.add(c.param<string>("anchor") === "corner" ? 0 : 0.5).div(res);
    return { uv: uv.id, texel: cell.id };
  },
});

const hitFlashNode: NodeDef = shNode({
  id: "hitFlash",
  category: "Sprite/Effects",
  name: "Hit Flash",
  synonyms: ["damage flash", "white flash", "blink flash", "flash overlay"],
  description:
    "Flash a sprite towards a colour. Amount is clamped to 0…1. Mix: RGB = mix(RGB, Flash, Amount) (Amount 1 = solid flash colour, Amount 0 = identity). Add: RGB = RGB + Flash · Amount (HDR glow). ALPHA IS ALWAYS PRESERVED: the flash never makes transparent pixels visible. Alpha mode Premultiplied scales the flash colour by the sprite alpha so premultiplied output stays valid. Colours are used as given (no sRGB conversion).",
  inputs: [colorPort("color", "Color"), rgbPort("flash", "Flash Color", [1, 1, 1]), floatPort("amount", "Amount", 0.5)],
  outputs: [{ id: "out", name: "Out", type: T("color4") }],
  params: [
    enumParam(
      "blend",
      "Blend",
      [
        ["mix", "Mix"],
        ["add", "Add"],
      ],
      "mix",
    ),
    enumParam(
      "alpha",
      "Alpha",
      [
        ["straight", "Straight"],
        ["premultiplied", "Premultiplied"],
      ],
      "straight",
    ),
  ],
  targetNotes: noteAll(),
  build: (c) => {
    const m = new M(c.b);
    const col = m.w(c.in("color"));
    const k = m.w(c.in("amount")).saturate();
    let flash = m.w(c.in("flash"));
    if (c.param<string>("alpha") === "premultiplied") flash = flash.mul(col.w);
    const rgb = c.param<string>("blend") === "add" ? col.sw("xyz").add(flash.mul(k)) : col.sw("xyz").mix(flash, k);
    return { out: m.vec("vec4", rgb, col.w).id };
  },
});

const shineSweepNode: NodeDef = shNode({
  id: "shineSweep",
  category: "Sprite/Effects",
  name: "Shine Sweep",
  synonyms: ["shine", "glint", "light sweep", "metallic sheen sweep"],
  description:
    "A bright diagonal band that sweeps across the 0…1 UV square. Direction d = (cos Angle, sin Angle) (degrees, CCW; the band travels along d, its edges are perpendicular). t = dot(UV − 0.5, d); the band centre moves linearly from −(E + Width/2) to +(E + Width/2) as Progress goes 0 → 1, E = (|cos| + |sin|)/2, so at Progress 0 and 1 the band is fully outside the quad (zero shine). Shine = 1 − smoothstep(Width/2 − Softness, Width/2, |t − centre|) ∈ [0, 1]: exactly 1 in the core, exactly 0 beyond Width/2, Softness clamped to 0…Width/2 (0 = hard edge). Progress is clamped to 0…1 (Loop: fract, repeats). Color = Tint · Intensity · Shine. Multiply Shine by the sprite alpha to keep the effect inside the sprite.",
  inputs: [
    uvPort(),
    floatPort("progress", "Progress", 0.5),
    floatPort("width", "Width", 0.2),
    floatPort("softness", "Softness", 0.08),
    floatPort("angle", "Angle", 45),
    floatPort("intensity", "Intensity", 1),
    rgbPort("tint", "Tint", [1, 1, 1]),
  ],
  outputs: [outPort("shine", "Shine", "float"), outPort("color", "Color", "color")],
  params: [{ id: "loop", label: "Loop", control: "bool", default: false }],
  targetNotes: noteAll("Drive Progress with Time (e.g. fract(time / period)) or a script property."),
  build: (c) => {
    const m = new M(c.b);
    const a = m.w(c.in("angle")).mul(Math.PI / 180);
    const dir = m.v2(a.cos(), a.sin());
    const e = a.cos().abs().add(a.sin().abs()).mul(0.5);
    const hw = m.w(c.in("width")).max(0).mul(0.5);
    const p = c.param<boolean>("loop") ? m.w(c.in("progress")).fract() : m.w(c.in("progress")).saturate();
    const ext = e.add(hw);
    const centre = ext.neg().add(p.mul(ext.mul(2)));
    const dist = m.w(c.in("uv")).sub(0.5).dot(dir).sub(centre).abs();
    const soft = m.w(c.in("softness")).clamp(0, 1e30).min(hw);
    const shine = m.f(1).sub(edge(m, hw.sub(soft), hw, dist));
    return {
      shine: shine.id,
      color: m
        .w(c.in("tint"))
        .mul(m.w(c.in("intensity")))
        .mul(shine).id,
    };
  },
});

const rippleNode: NodeDef = shNode({
  id: "rippleShockwave",
  category: "Sprite/Effects",
  name: "Ripple Shockwave",
  synonyms: ["shockwave", "water ripple", "radial distortion wave", "expanding ring"],
  description:
    "Expanding ring that displaces UVs. d = distance from Center in UV space with x scaled by Aspect (width / height, so rings are round); ring radius r(t) = Speed · Time (UV units). x = d − r; envelope = exp(−(x / Width)²) (gaussian ring of 1σ-ish half-width Width); wave = sin(2π · Frequency · x) (Frequency = oscillations per UV unit); fade = saturate(1 − Time / Lifetime) (Lifetime ≤ 0: no fade). Magnitude = Amplitude · envelope · wave · fade; Offset = radial unit vector (0 at the centre) · Magnitude, x divided by Aspect so the displacement is round on screen; UV' = UV + Offset (UV units; the sampler wrap decides outside 0…1). Time < 0: ring not started (radius negative). Deterministic in Time.",
  inputs: [
    uvPort(),
    vec2Port("center", "Center", [0.5, 0.5]),
    {
      id: "time",
      name: "Time",
      type: T("float"),
      default: 0,
      tooltip: "Seconds since the ripple started (wire the engine Time minus the start time).",
    },
    floatPort("speed", "Speed", 0.5),
    floatPort("width", "Width", 0.08),
    floatPort("frequency", "Frequency", 12),
    floatPort("amplitude", "Amplitude", 0.02),
    floatPort("lifetime", "Lifetime", 2),
    floatPort("aspect", "Aspect", 1),
  ],
  outputs: [outPort("offset", "Offset", "vec2"), outPort("uv", "UV", "vec2"), outPort("strength", "Strength", "float")],
  targetNotes: noteAll("Pure UV maths; combine with Sample Texture / Sprite Texture."),
  build: (c) => {
    const m = new M(c.b);
    const t = m.w(c.in("time"));
    const asp = m.w(c.in("aspect")).max(1e-3);
    const delta = m.w(c.in("uv")).sub(m.w(c.in("center")));
    const dd = m.v2(delta.x.mul(asp), delta.y);
    const d = dd.length();
    const x = d.sub(m.w(c.in("speed")).mul(t));
    const w = m.w(c.in("width")).max(1e-6);
    const q = x.div(w);
    const env = m.fn("exp", q.mul(q).neg());
    const life = m.w(c.in("lifetime"));
    const fade = m.sel(
      life.gt(1e-6),
      m
        .f(1)
        .sub(t.div(m.sel(life.gt(1e-6), life, 1)))
        .saturate(),
      1,
    );
    const mag = m
      .w(c.in("amplitude"))
      .mul(env)
      .mul(x.mul(m.w(c.in("frequency")).mul(TAU)).sin())
      .mul(fade);
    const dir = unit(m, dd, m.k("vec2", 0, 0));
    const offset = m.v2(dir.x.div(asp), dir.y).mul(mag);
    return { offset: offset.id, uv: m.w(c.in("uv")).add(offset).id, strength: env.mul(fade).id };
  },
});

const crtNode: NodeDef = shNode({
  id: "crtScanlines",
  category: "Sprite/Effects",
  name: "CRT Scanlines",
  synonyms: ["scanlines", "crt lines", "retro monitor lines", "interlace"],
  description:
    "Horizontal scanline darkening. s = (0.5 + 0.5·cos(2π·(Coord.y · Lines + Phase)))^Sharpness (1 at the line centre, 0 between lines), Factor = 1 − Intensity · (1 − s) ∈ [1 − Intensity, 1]; Out = Color · Factor. SCREEN-SPACE FREQUENCY: Lines = number of lines per 1.0 of Coord.y, so wire Screen Position (normalized) into Coord for 'lines per screen height' (use the vertical resolution, e.g. 240 for a 240-line look); the default UV0 gives lines per sprite height. Exactly periodic: Factor(y + 1/Lines) = Factor(y). Intensity is clamped 0…1, Sharpness ≥ 0.01. Phase scrolls the lines (1 = one full line).",
  inputs: [
    { id: "color", name: "Color", type: T("color"), default: [1, 1, 1] },
    {
      id: "coord",
      name: "Coord",
      type: T("vec2"),
      tag: { semantic: "uv" },
      defaultInput: { input: "uv0" },
      tooltip: "Screen UV (Screen Position › Normalized) for screen-space lines; defaults to UV0.",
    },
    floatPort("lines", "Lines", 240),
    floatPort("intensity", "Intensity", 0.4),
    floatPort("sharpness", "Sharpness", 1),
    floatPort("phase", "Phase", 0),
  ],
  outputs: [outPort("out", "Color", "color"), outPort("factor", "Factor", "float")],
  targetNotes: noteAll("Fragment-stage effect on a colour; no resolution is assumed — Lines carries it."),
  build: (c) => {
    const m = new M(c.b);
    const y = m.w(c.in("coord")).y;
    const s = y
      .mul(m.w(c.in("lines")))
      .add(m.w(c.in("phase")))
      .mul(TAU)
      .cos()
      .mul(0.5)
      .add(0.5)
      .pow(m.w(c.in("sharpness")).max(0.01));
    const factor = m.f(1).sub(m.w(c.in("intensity")).saturate().mul(m.f(1).sub(s)));
    return { out: m.w(c.in("color")).mul(factor).id, factor: factor.id };
  },
});

const chromaticNode: NodeDef = shNode({
  id: "chromaticAberration",
  category: "Sprite/Effects",
  name: "Chromatic Aberration",
  synonyms: ["rgb split", "color fringing", "channel offset", "lens fringe"],
  description:
    "Samples the texture three times and recombines the channels with shifted UVs. Offset: Radial = (UV − Center) · Strength (a fractional scale: 0.02 pushes the red channel 2 % further out), Directional = (cos Angle, sin Angle) · Strength (UV units). Channel offsets: RED samples at UV + Offset, GREEN at UV, BLUE at UV − Offset. RGB = (R(red tap), G(green tap), B(blue tap)); Alpha = max of the three taps' alpha so the fringes stay visible on the sprite edge. Strength 0 returns the plain texel. 3 fetches per pixel; implicit LOD (fragment) or Explicit LOD. Colours are not converted.",
  inputs: [
    texPort("tex", "Texture"),
    uvPort(),
    floatPort("strength", "Strength", 0.01),
    vec2Port("center", "Center", [0.5, 0.5]),
    floatPort("angle", "Angle", 0),
    lodPort(0),
  ],
  outputs: [{ id: "rgba", name: "RGBA", type: T("color4") }, outPort("offset", "Offset", "vec2")],
  params: [
    enumParam(
      "mode",
      "Mode",
      [
        ["radial", "Radial"],
        ["directional", "Directional"],
      ],
      "radial",
    ),
    SAMPLING_PARAM,
  ],
  targetNotes: noteAll("Wrap Clamp on the texture avoids smearing at the border."),
  build: (c) => {
    const m = new M(c.b);
    const uv = m.w(c.in("uv"));
    const k = m.w(c.in("strength"));
    const off =
      c.param<string>("mode") === "directional"
        ? (() => {
            const a = m.w(c.in("angle")).mul(Math.PI / 180);
            return m.v2(a.cos(), a.sin()).mul(k);
          })()
        : uv.sub(m.w(c.in("center"))).mul(k);
    const r = fetch(c, m, c.in("tex"), uv.add(off));
    const g = fetch(c, m, c.in("tex"), uv);
    const b = fetch(c, m, c.in("tex"), uv.sub(off));
    return { rgba: m.v4(r.x, g.y, b.z, r.w.max(g.w).max(b.w)).id, offset: off.id };
  },
});

const glitchNode: NodeDef = shNode({
  id: "glitch",
  category: "Sprite/Effects",
  name: "Glitch",
  synonyms: ["digital glitch", "horizontal tear", "signal glitch", "data moshing"],
  description:
    "Horizontal band glitch, DETERMINISTIC for a given (Time, Seed). The UV y range is cut into Bands rows; time is quantised into steps = floor(Time · Rate) (so the pattern is constant within a step and jumps Rate times per second — TEMPORAL BEHAVIOUR). For each (band, step) a hash decides whether the band is active (active when hash < Intensity: 0 = never, 1 = always) and a second hash gives a signed shift in [−Amount, Amount] added to U. Offset = (shift, 0); Mask = 1 on active bands. Bands is clamped to ≥ 1. Different Seeds give independent patterns. UV' = UV + Offset (the sampler wrap decides outside 0…1).",
  inputs: [
    uvPort(),
    { id: "time", name: "Time", type: T("float"), defaultInput: { input: "time" } },
    floatPort("seed", "Seed", 0),
    floatPort("intensity", "Intensity", 0.3),
    floatPort("amount", "Amount", 0.05),
    floatPort("bands", "Bands", 16),
    floatPort("rate", "Rate", 8),
  ],
  outputs: [outPort("uv", "UV", "vec2"), outPort("offset", "Offset", "vec2"), outPort("mask", "Mask", "float")],
  targetNotes: noteAll("Sine-free float hash: results are reproducible across targets up to float precision."),
  build: (c) => {
    const m = new M(c.b);
    const uv = m.w(c.in("uv"));
    const bands = m.w(c.in("bands")).floor().max(1);
    const stepN = m
      .w(c.in("time"))
      .mul(m.w(c.in("rate")).max(0))
      .floor();
    const band = uv.y.mul(bands).floor().clamp(0, 1e30).min(bands.sub(1));
    const seed = m.w(c.in("seed"));
    const r1 = hash21(m, m.v2(band.add(seed.mul(13.17)), stepN));
    const r2 = hash21(m, m.v2(band.mul(7.7).add(3.1), stepN.add(seed.mul(5.31)).add(0.5)));
    const active = m.sel(r1.lt(m.w(c.in("intensity"))), 1, 0);
    const offset = m.v2(
      r2
        .mul(2)
        .sub(1)
        .mul(m.w(c.in("amount")))
        .mul(active),
      0,
    );
    return { uv: uv.add(offset).id, offset: offset.id, mask: active.id };
  },
});

export const SPRITE_FX_DEFS: NodeDef[] = [
  outlineNode,
  pixelSnapNode,
  hitFlashNode,
  shineSweepNode,
  rippleNode,
  crtNode,
  chromaticNode,
  glitchNode,
];
