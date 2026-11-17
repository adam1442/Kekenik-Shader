import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { outlineKit } from "../lib";
import { slimeSprite } from "../textures/gen";
import { ALL_TARGETS, defineMeta } from "../3d/common";
import { SPRITE_PROFILE, SPRITE_PROP_ID, spriteTexProp } from "./common";

const meta = defineMeta({
  id: "sprite-outline-glow", title: "Sprite Outline + Glow",
  description: "Crisp outline and soft HDR glow around any sprite silhouette, built from the alpha channel only. Thickness and glow reach are measured in texels, so the look stays consistent for every sprite size.",
  tags: ["outline", "glow", "sprite", "2d", "hdr", "selection"], category: "2D / Sprites", difficulty: "Beginner", targets: ALL_TARGETS,
  compatNotes: ["Needs transparent padding around the sprite (≥ glow size texels) — the mesh quad clips the glow otherwise (use Full Rect mesh type + padding in the Sprite importer).", "Cost: about 30 texture fetches per pixel — declared Desktop. On mobile lower Glow Size to 0 (glow off) or bake the outline into the sprite.", "Reads the texture size (Texture Size node): Unity needs `_MainTex_TexelSize`, which the SpriteRenderer fills."],
  requiredFeatures: [], budgetClass: "Desktop", godotProfile: "godot.canvasitem", reusableSubgraphs: ["ks_outline_kit"],
  previewConfig: { mode: "2d", sprite: true, background: { mode: "checker" } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: SPRITE_PROFILE });
  s.add(
    spriteTexProp(),
    P.color("outlineColor", "Outline Color", { default: [0.06, 0.03, 0.14, 1], alpha: true, tooltip: "Colour and opacity (alpha) of the crisp outline.", category: "Outline" }),
    P.float("thickness", "Outline Thickness", { default: 1.5, min: 0, max: 4, tooltip: "Outline width in texels of the sprite texture.", category: "Outline" }),
    P.color("glowColor", "Glow Color", { default: [2.6, 1.7, 0.35, 1], alpha: true, hdr: true, tooltip: "HDR glow colour; alpha is the glow opacity. Values above 1 bloom with a Bloom post effect.", category: "Glow" }),
    P.float("glowSize", "Glow Size", { default: 7, min: 0, max: 14, tooltip: "Reach of the glow in texels (keep ≤ the transparent padding of the sprite).", category: "Glow" }),
    P.float("opacity", "Opacity", { default: 1, min: 0, max: 1, tooltip: "Overall opacity of sprite, outline and glow.", category: "Sprite" }),
  );
  s.texture(SPRITE_PROP_ID, "slime-sprite", slimeSprite(64, false));
  s.use(outlineKit());

  const src = s.block("src", "Sprite + UV", "The sprite texture and its UV. The kit below samples the sprite itself (several taps), so only the texture *asset* and the UV are passed in.", { col: 0, color: COLORS.blue });
  src.n("uv", "uv", {});

  const fx = s.block("fx", "Outline + glow", "The **Outline + Glow kit** samples the alpha on rings around each pixel: a thin ring gives the outline, three wider rings give a stepped, smooth glow. The result is composited *behind* the sprite with straight alpha.", { col: 1, color: COLORS.yellow });
  fx.sub("kit", "ks_outline_kit", { label: "Outline + Glow" });
  s.w(src.po(SPRITE_PROP_ID), "kit.tex", "Sprite").w("uv.out", "kit.uv", "UV")
    .w(fx.po("outlineColor"), "kit.outlineColor").w(fx.po("thickness"), "kit.thickness").w(fx.po("glowColor"), "kit.glowColor").w(fx.po("glowSize"), "kit.glowSize");

  const out = s.block("out", "Master output (URP Sprite Unlit)", "Splits the kit's RGBA into colour + alpha; the opacity slider only scales alpha, so the HDR glow keeps its colour.", { col: 2, color: COLORS.violet });
  out.n("split", "split", {});
  out.n("rgb", "combine", {});
  out.n("alpha", "multiply", {});
  s.master(out);
  s.w("kit.final", "split.in").w("split.r", "rgb.r").w("split.g", "rgb.g").w("split.b", "rgb.b").w("split.a", "alpha.a").w(out.po("opacity"), "alpha.b")
    .w("rgb.rgb", "master.baseColor").w("alpha.out", "master.alpha");
  return s;
}
export const outlineGlowSample: SampleModule = { meta, build };
