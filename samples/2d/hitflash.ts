import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { slimeSprite } from "../textures/gen";
import { ALL_TARGETS, defineMeta } from "../3d/common";
import { SPRITE_PROFILE, SPRITE_PROP_ID, spriteTexProp } from "./common";

const meta = defineMeta({
  id: "sprite-hit-flash", title: "Hit Flash",
  description: "Classic damage flash: the sprite blends to a flash colour (mix) and optionally over-brightens with an HDR add so Bloom makes it pop. Alpha is always preserved, so the flash never fills transparent pixels. The SpriteRenderer colour still tints the result.",
  tags: ["hit-flash", "damage", "sprite", "2d", "feedback", "hdr"], category: "2D / Sprites", difficulty: "Beginner", targets: ALL_TARGETS,
  compatNotes: ["Drive Flash Amount from a script with `MaterialPropertyBlock` (Unity) / `set_shader_parameter` (Godot) and ease it back to 0 over ~0.1 s.", "The SpriteRenderer colour arrives through the vertex colour (Unity) / `COLOR` (Godot)."],
  requiredFeatures: [], budgetClass: "Mobile", godotProfile: "godot.canvasitem",
  previewConfig: { mode: "2d", sprite: true, background: { mode: "dark" } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: SPRITE_PROFILE });
  s.add(
    spriteTexProp(),
    P.float("flash", "Flash Amount", { default: 0.6, min: 0, max: 1, tooltip: "0 = normal sprite, 1 = solid flash colour. Animate from gameplay.", category: "Flash" }),
    P.color("flashColor", "Flash Color", { default: [1, 1, 1], tooltip: "Colour the sprite flashes towards (sRGB).", category: "Flash" }),
    P.float("overbright", "HDR Overbright", { default: 0.8, min: 0, max: 4, tooltip: "Extra additive flash in HDR (> 1 blooms). 0 disables it.", category: "Flash" }),
  );
  s.texture(SPRITE_PROP_ID, "slime-sprite", slimeSprite(64, false));

  const src = s.block("src", "Sprite × vertex colour", "Sprite fetch multiplied by the vertex colour — that is how a SpriteRenderer's *Color* field (and its alpha fade) reaches a custom shader.", { col: 0, color: COLORS.blue });
  src.n("uv", "uv", {});
  src.n("sprite", "sampleTexture2D", {});
  src.n("vc", "vertexColor", {});
  src.n("tinted", "multiply", {});
  s.w(src.po(SPRITE_PROP_ID), "sprite.tex").w("uv.out", "sprite.uv").w("sprite.rgba", "tinted.a").w("vc.rgba", "tinted.b");

  const fl = s.block("flash", "Flash (mix, then HDR add)", "**Hit Flash** (Mix): `rgb = lerp(rgb, flash, amount)`. A second node in *Add* mode adds `flash × amount × overbright` on top, giving values above 1 for bloom. Both keep alpha untouched.", { col: 1, color: COLORS.yellow });
  fl.n("mixFlash", "hitFlash", { params: { blend: "mix", alpha: "straight" } });
  fl.n("addFlash", "hitFlash", { params: { blend: "add", alpha: "straight" } });
  fl.n("hdrAmount", "multiply", {});
  s.w("tinted.out", "mixFlash.color").w(fl.po("flashColor"), "mixFlash.flash").w(fl.po("flash"), "mixFlash.amount")
    .w("mixFlash.out", "addFlash.color").w(fl.po("flashColor"), "addFlash.flash").w(fl.po("flash"), "hdrAmount.a").w(fl.po("overbright"), "hdrAmount.b").w("hdrAmount.out", "addFlash.amount");

  const out = s.block("out", "Master output (URP Sprite Unlit)", "Final colour and the (untouched) sprite alpha.", { col: 2, color: COLORS.violet });
  out.n("split", "split", {});
  out.n("rgb", "combine", {});
  s.master(out);
  s.w("addFlash.out", "split.in").w("split.r", "rgb.r").w("split.g", "rgb.g").w("split.b", "rgb.b").w("rgb.rgb", "master.baseColor").w("split.a", "master.alpha");
  return s;
}
export const hitFlashSample: SampleModule = { meta, build };
