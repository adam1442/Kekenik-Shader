# Export Targets, Profiles & Verification Status

Kekenik Shader compiles a single node graph into five shader targets: **GLSL (WebGL2)**, **WGSL (WebGPU)**, **HLSL**, **Unity URP**, and **Godot 4.x**.

> **Honest Verification Status (`v0.1.0`):**  
> - **GLSL ES 3.00 (WebGL2)** is compiled and executed on a real WebGL2 GPU in the live preview viewport.  
> - **WGSL** is validated in-browser by `naga-wasm` (and by browser WebGPU when available).  
> - **HLSL**, **Unity URP**, and **Godot 4.x** outputs are generated from official language/pipeline specifications and checked by static validators (`hlsl.*`, `unity.*`, `godot.*`), but **have not yet been verified across all engine versions in live Unity or Godot editor builds**. Items requiring real-engine confirmation are listed below as **Experimental**.

---

## 1. Export Bundle & `parameters.json`

Opening **File → Export Shader…** (`Ctrl/Cmd+E`) builds a deterministic `.zip` archive:

```text
KekenikShader_<Name>/
  Unity/<Name>.shader
  Unity/KekenikSpriteRect.cs       (included only when the Sprite Rect node is used)
  Godot/<name>.gdshader
  GLSL/shader.vert
  GLSL/shader.frag
  HLSL/shader.hlsl
  WGSL/shader.wgsl
  parameters.json
  README.md
```

- **Deterministic Archives:** File paths are sanitized and sorted, and ZIP timestamps are fixed (`1980-06-15 12:00`), so identical graphs always produce byte-identical `.zip` files.
- **`parameters.json` Manifest:** Lists every exposed Blackboard property (`id`, `displayName`, `type`, `default`, `range`, `hdr`, `colorSpace`, `textureDefault`, `category`, `perInstance`, `godotGlobal`) along with its exact generated identifier on each target (`engineNames: { unity, godot, glsl, hlsl, wgsl }`), plus active keywords, surface options, and compiler warnings.

---

## 2. Unity URP (`ShaderLab + HLSL`)

### Supported Versions & Profiles
- **Target Versions:** Unity **2022.3 LTS** (URP 14.0.x) and **Unity 6.0 / 6.1 / 6.2 / 6.3 LTS** (URP 17.0.x–17.3.x, default `6000.3`). No Built-in RP and no HDRP.
- **Profiles:**
  - `unity.urp.lit` (**Lit**): `ForwardLit` (`UniversalForwardOnly`), optional `ShadowCaster`, `DepthOnly`, `DepthNormals`, plus optional `Meta` and `MotionVectors` passes. Calls `UniversalFragmentPBR`.
  - `unity.urp.simple-lit` (**Simple Lit**): Mobile Blinn-Phong (`UniversalFragmentBlinnPhong`) with `baseColor`, `specular`, `smoothness`, `normalTS`, `emission`, `alpha`.
  - `unity.urp.unlit` (**Unlit**): `Unlit` (`UniversalForwardOnly`), optional `ShadowCaster`, `DepthOnly`, `DepthNormals`.
  - `unity.urp.sprite-lit` (**Sprite Lit**): `Universal2D` (2D Renderer + `Light2D`), `NormalsRendering`, and `UniversalForward` unlit fallback. Binds `_MainTex`, `_NormalMap`, and `_MaskTex`.
  - `unity.urp.sprite-unlit` (**Sprite Unlit**): `Universal2D` + `UniversalForward`.
  - `unity.urp.vfx-unlit` (**VFX / Particles Unlit**): `Unlit` pass with particle vertex color, optional soft particles, flipbook frame blending, camera near/far fade, and opaque-texture distortion.

### Keywords & Material Properties
- **Colors:** `color` and `color4` properties emit `Color` (or `[HDR] Color`) in the `Properties` block. Raw vectors (`vec2/3/4`) emit `Vector` so Unity does not apply sRGB-to-linear conversion to non-color data.
- **Shader Variants:** Blackboard Boolean/Enum keywords and keyword-flagged Bool properties emit `[Toggle(_KW)]` / `[KeywordEnum(...)]` + `#pragma shader_feature_local` in every pass, reading the active branch through a compile-time `KS_KW_<NAME>` macro.
- **SRP Batcher:** All passes in Unlit, Simple Lit, and Lit share an identical `CBUFFER_START(UnityPerMaterial)` layout.

### Experimental Unity URP Items (Not Yet Verified in All Engine Versions)

| Area | Status | Notes |
|---|---|---|
| **Core URP Helper & Lighting Macros** (`UniversalFragmentPBR`, `UniversalFragmentBlinnPhong`, `GetVertexPositionInputs`, `TransformTangentToWorld`, `_CLUSTER_LIGHT_LOOP`) | **Experimental** | Validated by static `unity.api-whitelist` & `unity.include-whitelist` rules; requires import verification in Unity 2022.3 LTS and Unity 6.0–6.3. |
| **Lit Baked GI & Meta Pass** (`bakedGI`, `metaPass`: `DECLARE_LIGHTMAP_OR_SH`, `SAMPLE_GI`, `UnityMetaFragment`) | **Experimental** | Optional surface settings (off by default). Requires lightmap/shadowmask bake verification in Unity. |
| **Lit MotionVectors Pass** (`motionVectorsPass`, Unity 6+) | **Experimental** | Emits `MotionVectors` pass on Unity 6 targets (ignored with warning on 2022.3). |
| **LOD Cross-Fade & DBuffer Decals** (`lodCrossFade`, `dbufferDecals`) | **Experimental** | Optional Lit surface settings (`LODFadeCrossFade`, `_DBUFFER_MRT1/2/3`). |
| **Runtime Surface Options** (`exposeSurface`) | **Experimental** | Exposes `_SrcBlend`, `_DstBlend`, `_ZWrite`, `_Cull`, and `_ALPHATEST_ON` in the material inspector (enabled by default on Sprite/VFX profiles). |
| **VFX Flipbook Custom Vertex Streams, Camera Fade & Distortion** | **Experimental** | Requires matching Particle System Renderer Custom Vertex Streams (`Position`, `Color`, `UV`, `UV2`, `AnimBlend`) as documented in the exported shader header. |
| **Scene Depth / Color / Normals & Additional Lights** | **Experimental** | Pulls `DeclareDepthTexture.hlsl`, `DeclareOpaqueTexture.hlsl`, `DeclareNormalsTexture.hlsl`, or `Lighting.hlsl` on demand. |
| **Sprite Lit on Unity 6.3 (URP 17.x 2D includes)** | **Experimental** | Uses `CombinedShapeLightShared.hlsl` and `NormalsRenderingShared.hlsl`; needs verification on URP 17.x 2D Renderer. |
| **Sprite Rect Node + `KekenikSpriteRect.cs`** | **Experimental** | Exports a C# component that feeds `sprite.textureRect` into `_KsSpriteRect` via `MaterialPropertyBlock`. |
| **Translucency Approximation** | **Experimental** | Added as a portable wrap/back-light term into emission on URP Lit (URP Lit has no native translucency block). |

---

## 3. Godot 4.x (`gdshader`)

### Supported Versions & Profiles
- **Target Versions:** Godot **4.3** (default baseline), **4.4**, **4.5**, **4.6**, **4.7** across **Forward+**, **Mobile**, and **Compatibility** renderers.
- **Profiles:**
  - `godot.spatial` (**Spatial 3D**): `shader_type spatial;` with `ALBEDO`, `ALPHA`, `ALPHA_SCISSOR_THRESHOLD`, `NORMAL_MAP`, `METALLIC`, `ROUGHNESS` (`1.0 - smoothness`), `AO`, `EMISSION`, plus Godot-native `SPECULAR`, `RIM`, `RIM_TINT`, and `BACKLIGHT` (translucency).
  - `godot.canvasitem` (**CanvasItem 2D**): `shader_type canvas_item;` with `COLOR` and pixel-space `VERTEX` offsets.
  - `godot.spatial.vfx` (**VFX / Particles Spatial Preset**): Spatial preset configured for billboard/particle meshes with soft-particle depth fade.

### Uniforms, Hints & Functions
- Exposed parameters map to `uniform` declarations with `source_color`, `hint_range(min, max, step)`, `hint_enum(...)`, `hint_normal`, `hint_default_white/black/transparent`, filter/repeat hints, and `group_uniforms` categories.
- HDR colors above `1.0` split into a `source_color` base uniform and a companion `<name>_intensity` float uniform so the Godot color picker and linear shader math agree with the Kekenik preview.
- Per-instance parameters emit `instance uniform`, and global parameters emit `global uniform`.

### Experimental Godot 4 Items (Not Yet Verified in All Engine Versions)

| Area | Status | Notes |
|---|---|---|
| **Custom `light()` Stage** (`customLight` option + *Light (per light, Godot)* & *Light Surface (Godot)* nodes) | **Experimental** | Emits `void light()` accumulating `DIFFUSE_LIGHT +=` and `SPECULAR_LIGHT +=` per light. Vectors use Godot's view-space convention. Not simulated in the WebGL2 preview. |
| **Built-in Inputs Inside Subgraph/Helper Functions** (`lowerFunctionInputs`) | **Experimental** | Automatically threads stage built-ins (`UV`, `NORMAL`, `VIEW`, `VERTEX`) as hidden `kek_in_*` parameters at every function call site. |
| **Stencil Mode (`stencil_mode`, Godot 4.5+)** | **Experimental** | Version-gated to Godot 4.5+; emits `stencil_mode <flags>, compare_<op>, <ref>;` after `render_mode`. |
| **Inverted Depth Test (`depth_test_inverted`, Godot 4.5+)** | **Experimental** | Emitted for `Greater` / `GreaterEqual` depth tests on Godot 4.5+. |
| **Scene Depth Helper (`ks_scene_depth`) & Compatibility Renderer Depth** | **Experimental** | Emits `#if CURRENT_RENDERER == RENDERER_COMPATIBILITY` for NDC reconstruction; note that Compatibility uses standard-Z while Forward+/Mobile use reversed-Z. |
| **Translucency Mapping (`BACKLIGHT`)** | **Experimental** | Maps the portable Translucency / Thickness master blocks to Godot's `BACKLIGHT`. |
| **Godot-Native Blocks (`SPECULAR`, `RIM`, `RIM_TINT`) & `AO_LIGHT_AFFECT`** | **Experimental** | Emitted only when connected or non-default; default values match Godot 4 documentation. |

---

## 4. Portable Targets (GLSL, WGSL, HLSL)

- **GLSL ES 3.00 (`GLSL/shader.vert`, `GLSL/shader.frag`):** Verified in the browser via WebGL2 compilation. Expects standard `a_position`, `a_normal`, `a_tangent`, `a_uv0`, `a_color` attributes and `ks_*` camera/transform/time uniforms documented in the generated file header.
- **WGSL (`WGSL/shader.wgsl`):** Validated by `naga-wasm`. Uses `@group(0)` bindings for frame uniforms, material uniforms, textures, and samplers.
- **HLSL (`HLSL/shader.hlsl`):** Experimental Shader Model 5.0+ output (`VSMain` / `PSMain` with `cbuffer KsGlobals` and `cbuffer KsMaterial`). Checked by static rules (`src/core/codegen/hlsl/check.ts`), but not yet compiled with `dxc`/`fxc`.
