import { ATTR_MEMBER, type EmitCtx } from "./ctx";
import type { BuiltPasses } from "./sprite";
import { unlitForwardPass } from "./unlit";

/** VFX / Particles Unlit: single `UniversalForwardOnly` pass; header lists the Custom Vertex Streams the graph needs. */
export function vfxPasses(ctx: EmitCtx): BuiltPasses {
  ctx.attrs.add("a_color");
  ctx.attrs.add("a_uv0");
  const streams = ["Position (POSITION)", "Color (COLOR)", "UV (TEXCOORD0)"];
  for (const [a, label] of [
    ["a_uv1", "UV2"],
    ["a_uv2", "UV3"],
    ["a_uv3", "UV4"],
  ] as const)
    if (ctx.attrs.has(a))
      streams.push(
        `${label} (${ATTR_MEMBER[a].replace("uv", "TEXCOORD")})${a === "a_uv1" && ctx.flipbook ? " — next-frame UV (flipbook blending)" : ""}`,
      );
  if (ctx.flipbook) streams.push(`AnimBlend (TEXCOORD${ctx.flipbook.blendIndex}.x)`);
  return {
    passes: [
      unlitForwardPass(ctx, {
        name: "Unlit",
        lightMode: "UniversalForwardOnly",
        vertexColor: true,
        soft: ctx.o.softParticles,
        vfx: true,
      }),
    ],
    extra: [],
    headerExtra: [
      "// Particle System > Renderer > Custom Vertex Streams — enable exactly these, in this order:",
      ...streams.map((s, i) => `//   ${i + 1}. ${s}`),
      ...(ctx.o.softParticles ? ["// Soft particles need Depth Texture enabled in the URP asset."] : []),
      ...(ctx.o.distortion
        ? [
            "// Distortion needs Opaque Texture enabled in the URP asset (Base Color R,G = distortion vector, Alpha = strength).",
          ]
        : []),
      ...(ctx.flipbook
        ? [
            "// Flipbook blending: enable Texture Sheet Animation; the UV stream is the CURRENT frame, UV2 the NEXT frame.",
          ]
        : []),
    ],
  };
}
