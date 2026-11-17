# Preview Surface Contract (Kekenik Shader)

The Preview compiles the graph through the **same GLSL backend** as the Code panel (`surface: "preview"` emit option — no second generator). Besides the color output, that option writes **every master block of the active profile** into the global `KsSurface ks_surf` at the end of `main()`. The lighting prelude (`src/preview/gl/lighting/prelude.ts`) turns it into linear HDR radiance; post-processing (`src/preview/gl/post`) applies exposure, bloom, tone mapping, and sRGB conversion.
Exported GLSL never contains this code. The mapping table is `PREVIEW_SURFACE_MAP` in `src/core/codegen/glsl/surface.ts`.

| Block id | `KsSurface` field | Conversion | Fidelity |
|---|---|---|---|
| `positionOS` | vertex stage | object-space position replaces `a_position` | exact |
| `normalOS` | — (`notPreviewable`) | the preview vertex stage displaces positions only | — |
| `tangentOS` | — (`notPreviewable`) | the mesh tangent (or a derivative frame) is used | — |
| `baseColor` | `baseColor` | linear rgb as authored | exact |
| `alpha` | `alpha` | none; blend / clip per the profile's surface options | exact |
| `alphaClipThreshold` | (`discard`) | discard when `alpha < threshold` (part of the exported fragment code) | exact |
| `normalTS` | `normalTS` + `hasNormal` | tangent → world through the mesh TBN (derivative frame without tangents) | exact |
| `metallic` | `metallic` | clamp 0..1; `F0 = mix(0.04…, albedo, metallic)` | exact |
| `smoothness` | `smoothness` | perceptual roughness = `1 − smoothness` (Godot `roughness` is stored as smoothness by the profile framework) | exact |
| `occlusion` | `occlusion` | multiplies diffuse + specular **ambient** only | exact |
| `emission` | `emission` | added after lighting, HDR (> 1 survives to bloom) | exact |
| `specular` | `specular` | dielectric `F0 = 0.08 · specular` (Godot `SPECULAR`) | exact |
| `rim` | `rim` | `rim · pow(1 − N·V, 4) · lerp(white, albedo, rimTint)` from the key light color | approximate — Godot adds it per light in `light()` |
| `rimTint` | `rimTint` | see `rim` | approximate |
| `translucency` | `translucency` | `translucency · (1 − thickness) · albedo · mainLight · saturate(dot(−N, L))` | approximate — portable wrap term: Unity Lit adds it to emission, Godot uses `BACKLIGHT` (experimental), URP Lit has no native translucency |
| `thickness` | `thickness` | scales translucency by `(1 − thickness)` | approximate |
| `lightDiffuse` | — (`notPreviewable`) | Godot `light()` (`Custom light()`) runs once per light inside the engine; the preview keeps the default lighting | — |
| `lightSpecular` | — (`notPreviewable`) | see `lightDiffuse` | — |
| `lightAlpha` | — (`notPreviewable`) | see `lightDiffuse` | — |
| `spriteMask` | — (`notPreviewable`) | Sprite Lit's secondary mask texture is not used by the preview's 2D-light approximation | — |

## BRDF Set (Approximations, Labeled in the UI)
* **Unity-like** — Lambert + GGX / Smith-Schlick, Schlick Fresnel, ambient = SH-like irradiance (blurred environment mip) × occlusion.
* **Godot-like** — Burley diffuse + Schlick-GGX. The set follows the simulated target (Target dropdown → Simulation).
* Key / fill / rim directional lights; key light has a 1024² shadow map with 3×3 PCF (softness / bias in Preview → Lighting).
* Unlit / Sprite / VFX profiles bypass lighting (`KsSurface.unlit`); fog and debug views still apply.

## Debug Views (Preview Toolbar → Shading View)
Shader (final) · UV checker · Normals (mesh) · Base Color · Normal (tangent) · Normal (world) · Metallic · Smoothness · Occlusion · Emission · Alpha · Vertex Color · Scene Depth.
