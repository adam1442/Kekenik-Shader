import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { softDissolve } from "../lib";
import { fbm, heightTex, slimeSprite } from "../textures/gen";
import { ALL_TARGETS, defineMeta } from "../3d/common";
import { SPRITE_PROFILE, SPRITE_PROP_ID, spriteTexProp } from "./common";

const meta = defineMeta({
  id: "sprite-dissolve", title: "Sprite Dissolve",
  description: "Noise dissolve for sprites with a glowing HDR burn edge and an optional direction bias (bottom-up / top-down). Animate one slider from gameplay for death, spawn and teleport effects.",
  tags: ["dissolve", "sprite", "2d", "emission", "death-effect"], category: "2D / Sprites", difficulty: "Beginner", targets: ALL_TARGETS,
  compatNotes: ["Alpha-blended: no alpha clip, so the soft border stays smooth. Noise texture should repeat (Wrap Mode Repeat)."],
  requiredFeatures: [], budgetClass: "Mobile", godotProfile: "godot.canvasitem", reusableSubgraphs: ["ks_soft_dissolve"],
  previewConfig: { mode: "2d", sprite: true, background: { mode: "dark" } },
});
const noise = heightTex(fbm(128, 128, 4, 4, 31), "Seeded tileable fractal noise (dissolve pattern)");

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: SPRITE_PROFILE });
  s.add(
    spriteTexProp(),
    P.tex("noiseTex", "Dissolve Noise", { default: "grey", tooltip: "Greyscale pattern: dark areas dissolve first.", category: "Dissolve" }),
    P.float("amount", "Dissolve", { default: 0.45, min: 0, max: 1, tooltip: "0 = fully visible, 1 = fully dissolved. Animate this from gameplay.", category: "Dissolve" }),
    P.float("noiseScale", "Noise Scale", { default: 1.5, min: 0.25, max: 8, tooltip: "How often the noise repeats across the sprite.", category: "Dissolve" }),
    P.float("direction", "Direction Bias", { default: 0.35, min: 0, max: 1, tooltip: "0 = pure noise, 1 = a clean bottom-up sweep. In between the noise rides on the sweep.", category: "Dissolve" }),
    P.float("softness", "Edge Softness", { default: 0.03, min: 0, max: 0.2, tooltip: "Feathering of the cut.", category: "Edge" }),
    P.float("edgeWidth", "Edge Width", { default: 0.1, min: 0, max: 0.4, tooltip: "Width of the glowing burn band.", category: "Edge" }),
    P.color("edgeColor", "Edge Color", { default: [4.5, 1.5, 0.3], hdr: true, tooltip: "HDR colour of the burn edge (above 1 = bloom).", category: "Edge" }),
  );
  s.texture(SPRITE_PROP_ID, "slime-sprite", slimeSprite(64, false));
  s.texture("noiseTex", "dissolve-noise", noise);
  s.use(softDissolve());

  const src = s.block("src", "Sprite sample", "Plain sprite fetch. Its alpha is multiplied with the dissolve mask later, so the transparent pixels stay transparent.", { col: 0, color: COLORS.blue });
  src.n("uv", "uv", {});
  src.n("sprite", "sampleTexture2D", {});
  s.w(src.po(SPRITE_PROP_ID), "sprite.tex").w("uv.out", "sprite.uv");

  const pat = s.block("pattern", "Dissolve pattern", "Noise is sampled with scaled UV, then blended towards the V coordinate by **Direction Bias**: `pattern = lerp(noise, v, bias)`. A pure gradient dissolves as a clean sweep; some noise keeps it organic.", { col: 1, color: COLORS.violet });
  pat.n("scaled", "multiply", {});
  pat.n("noise", "sampleTexture2D", {});
  pat.n("vsplit", "split", {});
  pat.n("nsplit", "split", {});
  pat.n("mix", "lerp", {});
  s.w("uv.out", "scaled.a").w(pat.po("noiseScale"), "scaled.b").w(pat.po("noiseTex"), "noise.tex").w("scaled.out", "noise.uv")
    .w("uv.out", "vsplit.in").w("noise.rgb", "nsplit.in").w("nsplit.r", "mix.a").w("vsplit.g", "mix.b").w(pat.po("direction"), "mix.t");

  const cut = s.block("cut", "Soft dissolve", "The **Soft Dissolve** kit converts *pattern + amount* into a feathered alpha mask and a thin edge band (the burn).", { col: 2, color: COLORS.orange });
  cut.sub("dis", "ks_soft_dissolve", { label: "Dissolve" });
  s.w("mix.out", "dis.noise", "Pattern").w(cut.po("amount"), "dis.amount").w(cut.po("edgeWidth"), "dis.edgeWidth").w(cut.po("softness"), "dis.softness");

  const comp = s.block("comp", "Compose", "`colour = sprite + edge × edge colour` (HDR, so it glows) and `alpha = sprite alpha × dissolve alpha`.", { col: 3, color: COLORS.red });
  comp.n("glow", "multiply", {});
  comp.n("col", "add", {});
  comp.n("alpha", "multiply", {});
  s.w("dis.edge", "glow.a").w(comp.po("edgeColor"), "glow.b").w("sprite.rgb", "col.a").w("glow.out", "col.b").w("sprite.a", "alpha.a").w("dis.alpha", "alpha.b");

  const out = s.block("out", "Master output (URP Sprite Unlit)", "Colour and alpha of the burning sprite.", { col: 4, color: COLORS.violet });
  s.master(out);
  s.w("col.out", "master.baseColor").w("alpha.out", "master.alpha");
  return s;
}
export const spriteDissolveSample: SampleModule = { meta, build };
