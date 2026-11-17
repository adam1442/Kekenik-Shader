# Engine Verification Test Protocol (Unity URP & Godot 4)

Because Kekenik Shader is a browser-only application, its automated CI pipeline verifies **Unity URP** (`.shader`), **Godot 4** (`.gdshader`), and **HLSL** (`.hlsl`) outputs using static syntax/whitelist validators (`src/core/codegen/unity/validate*.ts`, `src/core/codegen/godot/validate*.ts`, `src/core/codegen/hlsl/check.ts`).

Before marking any experimental engine feature as **Verified** in [`docs/EXPORT_TARGETS.md`](EXPORT_TARGETS.md), maintainers and contributors should run the real-engine verification protocol below.

---

## 1. Generate the Engine Test Bundle

Run the maintainer bundle generator from the repository root:

```bash
node -e 'import("vite").then(async({createServer})=>{const s=await createServer({server:{middlewareMode:true},appType:"custom",logLevel:"error"});try{const m=await s.ssrLoadModule("/tools/export-engine-test-bundle.ts");await m.runCli(["/tmp/kekenik-engine-tests"]);}finally{await s.close();}})'
```

This writes deterministic multi-target bundles for every canonical profile graph (`UnlitTextured`, `LitPBR`, `CutoutDoubleSided`, `SpriteLitNormal`, `ParticleAdditiveSoft`) into `/tmp/kekenik-engine-tests/`.

---

## 2. Unity URP Verification Checklist

Test in **Unity 2022.3 LTS** (URP 14.x) and **Unity 6.3 LTS** (URP 17.x) with Linear color space:

1. **Clean Import (`import`, `no-pink`):**
   - Copy the generated `Unity/*.shader` files (and `KekenikSpriteRect.cs` if testing `Sprite Rect`) into `Assets/Shaders/`.
   - Confirm the Unity Console shows zero shader compilation errors or warnings and no material renders magenta.
2. **Material Inspector & SRP Batcher (`inspector`, `srp-batcher`):**
   - Create a Material for `UnlitTextured` and `LitPBR`.
   - Select the `.shader` asset and confirm the Inspector reports **SRP Batcher: compatible** for Unlit, Simple Lit, and Lit profiles.
   - Verify range sliders, `[HDR]` color pickers, texture defaults (`white`, `bump`), integer fields, vectors, and `[Toggle]` / `[KeywordEnum]` drawers match `parameters.json`.
3. **Lit Lighting, Shadows & SSAO (`lit-shadows`, `soft-shadows`, `lit-normal-map`, `ssao-depthnormals`, `depth-priming`):**
   - Test `LitPBR` under both **Forward** and **Forward+** rendering paths with a Directional Light + Point Light.
   - Verify shadow casting/receiving, soft shadow quality tiers, SSAO (with *Depth Normals* source), and *Depth Priming* mode.
4. **Alpha Clip & Double-Sided Normals (`alpha-clip`, `double-sided`):**
   - Test `CutoutDoubleSided` and confirm cutout edges match across the color pass, `ShadowCaster`, `DepthOnly`, and `DepthNormals`, and back-face lighting flips normals properly.
5. **2D Sprite Lit & Unlit (`sprite-2d`, `sprite-universal`, `sprite-secondary`):**
   - Assign `SpriteLitNormal` to a `SpriteRenderer` under a **2D Renderer** with a `Light2D` and Secondary Textures `_NormalMap` and `_MaskTex`.
   - Verify the unlit fallback pass under the Universal 3D Renderer.
6. **VFX / Particles (`particles`, `vfx-flipbook`, `vfx-camera-fade`, `vfx-distortion`):**
   - Assign `ParticleAdditiveSoft` to a Particle System Renderer with *Depth Texture* and *Opaque Texture* enabled on the URP Asset.
   - When testing flipbook blending, match the Particle System's **Custom Vertex Streams** to the exact `TEXCOORD` list in the generated shader header.
7. **Optional Lit Passes (`lit-gi`, `lit-meta`, `lit-motion-vectors`, `lit-decals`, `lit-lod-crossfade`):**
   - Export a Lit graph with *Baked GI*, *Meta pass*, *Motion Vectors pass* (Unity 6+), *DBuffer decals*, and *LOD cross-fade* enabled, and verify lightmap baking and camera motion blur.

---

## 3. Godot 4 Verification Checklist

Test in **Godot 4.3** and **Godot 4.5+** across **Forward+**, **Mobile**, and **Compatibility** renderers:

1. **Clean Import & Inspector (`import`, `inspector`, `hdr`, `color-default`):**
   - Copy `Godot/*.gdshader` into a Godot project and assign each to a `ShaderMaterial`.
   - Confirm the Shader editor output panel shows zero syntax or type errors.
   - Verify uniform hints (`source_color`, `hint_range`, `hint_enum`, `hint_normal`), `group_uniforms` collapsible sections, and HDR `<name>_intensity` split uniforms match the Kekenik preview.
2. **Spatial 3D Lighting & Render Modes (`renderers`, `blend`, `alpha-clip`, `double-sided`, `shadows-disabled`, `native-blocks`):**
   - Verify `LitPBR` and `CutoutDoubleSided` under Forward+, Mobile, and Compatibility with `DirectionalLight3D` and `OmniLight3D`.
   - Check `ALPHA_SCISSOR_THRESHOLD`, `cull_disabled`, `SPECULAR`, `RIM`, and `RIM_TINT`.
3. **CanvasItem 2D (`canvasitem`, `canvas-vertex-units`):**
   - Assign a `godot.canvasitem` shader to a `Sprite2D` with a `PointLight2D` and normal map; verify vertex offsets move in pixel units.
4. **Soft Particles & Scene Depth (`soft-particles`, `scene-intrinsics`):**
   - Verify soft particles and `Scene Depth` / `Scene Color` nodes on Forward+ and Compatibility renderers.
5. **Custom `light()` Stage, Subgraph Built-ins & Stencil (`light-stage`, `function-builtins`, `stencil-mode`):**
   - Test a Spatial shader with *Custom light()* enabled (`DIFFUSE_LIGHT +=`, `SPECULAR_LIGHT +=`), a Subgraph reading `UV`/`NORMAL` (lowered `kek_in_*` parameters), and `stencil_mode` on Godot 4.5+.
