import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { pixelSnap } from "../lib";
import { slimeSprite } from "../textures/gen";
import { ALL_TARGETS, defineMeta } from "../3d/common";
import { SPRITE_PROFILE, SPRITE_PROP_ID, spriteTexProp } from "./common";

const meta = defineMeta({
  id: "sprite-pixelate", title: "Pixelate / Pixel-Perfect Snap",
  description: "Snaps the sprite UV to a coarse texel grid (retro pixelation or pixel-perfect rendering at any scale and rotation), reduces the colour count with a posterize step and keeps alpha hard so the silhouette stays crisp.",
  tags: ["pixelate", "pixel-perfect", "retro", "posterize", "sprite", "2d"], category: "2D / Sprites", difficulty: "Intermediate", targets: ALL_TARGETS,
  compatNotes: ["Import the sprite with Filter = Point (no filter) for true pixel art; the snapping itself works with any filter.", "Pixel Grid = the sprite's pixel size gives a 1:1 pixel-perfect result."],
  requiredFeatures: [], budgetClass: "Mobile", godotProfile: "godot.canvasitem", reusableSubgraphs: ["ks_pixel_snap"],
  previewConfig: { mode: "2d", sprite: true, nearest: true, background: { mode: "checker" } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: SPRITE_PROFILE });
  s.add(
    spriteTexProp(),
    P.float("pixels", "Pixel Grid", { default: 24, min: 4, max: 128, step: 1, tooltip: "Pixels per axis of the snapping grid (the sprite's own pixel size = 1:1).", category: "Pixelation" }),
    P.float("steps", "Color Steps", { default: 5, min: 2, max: 16, step: 1, tooltip: "Levels per colour channel after posterizing.", category: "Pixelation" }),
    P.float("alphaCut", "Alpha Threshold", { default: 0.5, min: 0.01, max: 0.99, tooltip: "Alpha at or above this becomes fully opaque, below it fully transparent (hard pixel edges).", category: "Pixelation" }),
  );
  s.texture(SPRITE_PROP_ID, "slime-sprite", slimeSprite(64, false));
  s.use(pixelSnap());

  const g = s.block("grid", "Snap UV to the pixel grid", "The **Pixel Snap** kit moves every UV to the centre of its grid cell: `uv' = (floor(uv × res) + 0.5) / res`. All screen pixels inside one cell then read the *same* texel.", { col: 0, color: COLORS.green });
  g.n("uv", "uv", {});
  g.n("res", "combine", {});
  g.sub("snap", "ks_pixel_snap", { label: "Pixel Snap" });
  s.w(g.po("pixels"), "res.r").w(g.po("pixels"), "res.g").w("uv.out", "snap.uv", "UV").w("res.rg", "snap.resolution");

  const t = s.block("tex", "Sample + posterize", "Sprite fetch at the snapped UV, then **Posterize** limits each channel to *Color Steps* levels (round mode keeps pure black and white).", { col: 1, color: COLORS.blue });
  t.n("sprite", "sampleTexture2D", { params: { mode: "lod" }, values: { lod: 0 } });
  t.n("poster", "colorPosterize", { params: { mode: "round" } });
  s.w(t.po(SPRITE_PROP_ID), "sprite.tex").w("snap.uv", "sprite.uv").w("sprite.rgba", "poster.in").w(t.po("steps"), "poster.steps");

  const a = s.block("alpha", "Hard alpha", "`alpha = step(threshold, a)` — partial alpha (from filtering or the source art) is snapped to 0 or 1, so the silhouette is made of whole pixels.", { col: 1, row: 1, color: COLORS.orange });
  a.n("cut", "step", {});
  s.w(a.po("alphaCut"), "cut.edge").w("sprite.a", "cut.in");

  const out = s.block("out", "Master output (URP Sprite Unlit)", "Posterized colour with hard alpha.", { col: 2, color: COLORS.violet });
  out.n("split", "split", {});
  out.n("rgb", "combine", {});
  s.master(out);
  s.w("poster.out", "split.in").w("split.r", "rgb.r").w("split.g", "rgb.g").w("split.b", "rgb.b").w("rgb.rgb", "master.baseColor").w("cut.out", "master.alpha");
  return s;
}
export const pixelateSample: SampleModule = { meta, build };
