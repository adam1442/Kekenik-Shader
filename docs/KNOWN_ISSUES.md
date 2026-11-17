# Known Issues & Limitations (`v0.1.0` Early Preview)

This document tracks known limitations, unverified engine features, and deferred functionality in **Kekenik Shader v0.1.0**.

---

## 1. Engine Export Verification Status

- **Unity URP (`ShaderLab + HLSL`) and Godot 4 (`gdshader`) exports have not yet been verified across all engine versions.**
  - All Unity URP (`2022.3 LTS`, `6000.0`–`6000.3`) and Godot (`4.3`–`4.7`) code paths are checked by static syntax, whitelist, and semantic validators (`src/core/codegen/unity/validate*.ts`, `src/core/codegen/godot/validate*.ts`), but they have not all been imported and tested inside live Unity and Godot editors yet.
  - Specifically, advanced options marked **Experimental** in [`docs/EXPORT_TARGETS.md`](docs/EXPORT_TARGETS.md) (such as Unity Baked GI, Meta pass, MotionVectors pass, DBuffer decals, LOD cross-fade, VFX custom vertex stream packing, Sprite Lit on URP 17.x, and Godot custom `light()` stage, `stencil_mode`, and hidden function input lowering) may require adjustments after testing in real engine builds.
  - Maintainers and contributors can generate a complete test suite of shaders for manual engine verification using `tools/export-engine-test-bundle.ts` and [`docs/ENGINE_TEST_PROTOCOL.md`](docs/ENGINE_TEST_PROTOCOL.md).
- **Generic HLSL Target:**
  - The standalone HLSL target (`HLSL/shader.hlsl`) is checked by a static analyzer (`src/core/codegen/hlsl/check.ts`) rather than compiled through native `dxc` or `fxc`.

---

## 2. Unity URP Scope Limitations

- **No Built-in RP or HDRP:** Kekenik Shader targets **Universal Render Pipeline (URP)** only.
- **Forward Rendering Path (`UniversalForwardOnly`):** Exported Unity Lit shaders do not currently emit a `UniversalGBuffer` pass. In a Deferred URP renderer, objects using Kekenik Lit shaders automatically render in the forward pass bucket.
- **DOTS Instancing & Adaptive Probe Volumes (APV):** Standard GPU Instancing (`UNITY_VERTEX_INPUT_INSTANCE_ID` + `Instance ID` node) is supported, but `DOTS_INSTANCING_ON` metadata blocks and URP 17 `PROBE_VOLUMES_L1/L2` pragmas are not yet emitted.

---

## 3. Godot 4 Scope Limitations

- **Compatibility Renderer Depth Orientation:** In Godot 4.3+, Forward+ and Mobile renderers use reversed-Z depth (`1.0` = near), whereas the Compatibility renderer uses standard-Z (`0.0` = near). While the generated `ks_scene_depth` helper includes the `#if CURRENT_RENDERER == RENDERER_COMPATIBILITY` NDC branch, the linear/eye depth conversions on the *Scene Depth* node assume reversed-Z.
- **Custom `light()` Stage Not Shown in Preview:** When **Custom light()** is enabled on a Godot Spatial profile, the custom per-light calculation is emitted into `void light() { ... }` in `.gdshader`, but the browser WebGL2 preview continues to display standard preview lighting.
- **Particle Process Shaders (`shader_type particles`):** Out of scope (`0.1.0` exports material shaders; `GPUParticles3D` draw-pass surface materials are supported via the `godot.spatial.vfx` profile).

---

## 4. Property Model & Editor UX Limitations

- **Texture Array / 3D / Cubemap Properties:** `Texture2DArray`, `Texture3D`, and `Cubemap` property kinds are not yet available as exposed Blackboard properties (only `Texture 2D` properties can be exposed on the Blackboard in `0.1.0`).
- **Gradient & Curve Properties:** Gradients and curves are authored inline on nodes (and can be baked into 1D LUT textures via **Bake Texture…**), but cannot yet be exposed as dynamic Blackboard parameters.
- **Vertex Hoisting:** The optimizer's vertex-hoisting planner identifies per-pixel expressions that are affine in vertex attributes and surfaces them in the Optimizer Report / Statistics hints, but does not yet automatically rewrite them into custom vertex-to-fragment interpolators.
- **Light Theme:** The dark theme is the primary design target. The light theme option in Preferences is an early preview skin and several canvas/renderer colors remain dark-themed.
