# Changelog

## [Unreleased]

### Fixed
- **Godot export: "Unknown identifier in expression: 'INV_PROJECTION_MATRIX' / 'PROJECTION_MATRIX'"** (Stylized Water sample, any graph using Scene Depth / Camera Near-Far / Soft Particle Fade …). The engine helper `ks_camera_params()` read processor-only built-ins inside a user function. Engine helpers now take the built-ins as parameters and `core/ir/lowerEngine.ts` passes them from `vertex()` / `fragment()` (E7b); helper functions get hidden `kek_b_*` parameters.
- `canvas_item` exports of nodes that need a 3D camera / `FRONT_FACING` / view-projection matrices are now a clean unsupported diagnostic instead of invalid code.
- `godot` data: global built-ins now include `TAU`, `E`, `OUTPUT_IS_SRGB`, `CLIP_SPACE_FAR`, `IN_SHADOW_PASS`; spatial scope tables are transcribed from the official docs (`data/builtinScopes.ts`); `CLEARCOAT_GLOSS` is valid (it was wrongly listed as removed); the function table is complete.
- Validator: `vec3(saturate(x))` no longer hides an unknown function.

### Added
- Strict Godot validator rules: `godot.builtin-out-of-scope`, `godot.readonly-assign`, `godot.unknown-function`, `godot.unknown-identifier`, `godot.arity`, `godot.int-float-mix`, `godot.arg-type`, `godot.varying-int-needs-flat`, `godot.reserved-name`.
- Vitest suites `tests/fixG.*` (`npm test`): docs-pinned scope tables, validator negatives, exhaustive node × profile × {main, helper} sweep (`docs/EXPORT_MATRIX.md`), sample corpus, known-error fixtures.
- `core/engine/knownErrors.ts` (engine message → explanation / fix) and `docs/KNOWN_ENGINE_ERRORS.md`.


All notable changes to **Kekenik Shader** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-17

### Added

- **Core Compiler & Typed IR (`src/core`):**
  - Pure TypeScript shader graph compiler with 13 port types (`float`, `int`, `bool`, `vec2`, `vec3`, `vec4`, `color`, `color4`, `mat2`, `mat3`, `mat4`, `texture2D`, `sampler`), a 13×13 implicit conversion matrix, and generic port group resolution.
  - Hash-consed SSA-style Intermediate Representation (IR) with 38 portable intrinsics, stage legality analysis (vertex, fragment, and Godot light stages), source mapping, and a deterministic CPU reference evaluator.
  - Multi-level IR optimizer (Level 0: disabled, Level 1: constant folding, algebraic identities, common subexpression elimination, dead-code elimination; Level 2: fast-math identities), range/precision analysis, and per-node cost estimation.
  - Immutable graph model with invertible `PatchOp` undo/redo history, deterministic `.kshader` and `.kshadersub` JSON serialization, and schema validation.
- **Multi-Target Code Generation & Validation (`src/core/codegen`):**
  - **GLSL ES 3.00 (WebGL2)** vertex and fragment emitter with live GPU compilation and validation.
  - **WGSL (WebGPU)** emitter with bundled `naga-wasm` validation and optional browser WebGPU module verification.
  - **HLSL (Shader Model 5.0+)** emitter with static syntax and intrinsic checks.
  - **Unity URP (`ShaderLab + HLSL`)** exporter targeting Unity 2022.3 LTS (URP 14.x) and Unity 6.0–6.3 (URP 17.x) with profiles for **Lit**, **Simple Lit**, **Unlit**, **Sprite Lit**, **Sprite Unlit**, and **VFX / Particles Unlit**, real shader variants (`shader_feature_local`), optional Baked GI / Meta / MotionVectors / LOD cross-fade / DBuffer decals passes, and static `unity.*` validators.
  - **Godot 4.x (`gdshader`)** exporter targeting Godot 4.3–4.7 (Forward+, Mobile, Compatibility) with profiles for **Spatial (3D)**, **CanvasItem (2D)**, and **VFX / Particles**, uniform hints and groups, optional custom `light()` stage and `stencil_mode` (4.5+), automatic lowering of built-in inputs in helper functions, and static `godot.*` validators.
- **Node Library (`src/core/nodes`):**
  - Over 180 nodes spanning Constants, Inputs (Object, Camera, Scene Depth/Color/Normals, Time, UV, Vertex Color, Particle & Sprite streams), Math, Vector/Matrix, UV Manipulation, Procedural Noise (Value, Perlin, Simplex 1D/2D/3D, Worley/Voronoi 2D/3D, FBM, Curl, Gabor), SDF 2D/3D Shapes & Boolean Ops, Patterns, Gradients, Color Spaces & Adjustments, Texture Sampling (including Triplanar, Flow, Parallax, Height-to-Normal, Flipbook), Lighting & Shading helpers, Vertex Displacement, and Custom Function blocks.
- **Node Canvas & Structural Tools (`src/ui/graph`):**
  - Interactive pan/zoom canvas with viewport culling, typed port indicators, gradient implicit-conversion wires, box selection, grid snapping, and minimap.
  - `Space`-tap fuzzy node search popup (with synonyms, category filtering, recents, and favorites) and customizable single-key quick-node shortcuts.
  - Structural graph nodes: wire Reroute knots, wireless named Portal In / Portal Out channels with live marching-ants links, collapsible Groups with border proxy ports, Markdown Comment notes, and hierarchical Subgraphs with breadcrumb navigation.
- **Blackboard, Inspector & Material Emulation (`src/blackboard`):**
  - Blackboard panel for exposed material properties and Boolean/Enum keywords with per-target reference name sanitization and collision checks.
  - Context-sensitive Inspector (Node, Property, Graph Settings, Subgraph I/O, Selection) and live **Material** inspector panel with `parameters.json` manifest preview.
- **Live 3D / 2D Sprite / VFX Preview (`src/preview`):**
  - Three.js WebGL2 preview viewport with Unity-like and Godot-like BRDF approximations, studio lighting rig, shadow mapping, HDR environments, bloom, tone mapping, and 13 diagnostic shading views.
  - Custom asset import (`.glb`, `.gltf`, `.obj`, `.fbx`, `.png`, `.jpg`, `.webp`, `.hdr`), 2D sprite sheet slicing/animation, and a deterministic CPU particle emitter for VFX shaders.
  - Per-node live 2D thumbnails rendered via a throttled offscreen WebGL2 pool.
- **Pro Workflow & Sample Library (`src/app`, `samples/`):**
  - Deterministic multi-target `.zip` Export Dialog (`Mod+E`), 1D/2D Texture Bake Dialog, Optimizer Report & Performance Benchmark dialogs, IndexedDB project snapshots, and autosave crash recovery.
  - Built-in **Samples Browser** featuring 39 procedural showcase shaders (16 × 3D/Lit, 12 × 2D Sprites, 11 × VFX/Particles) and 16 reusable subgraph kits.

### Known Limitations in 0.1.0 (Early Preview)

- **Engine Verification Status:** Unity URP and Godot 4 exports are checked by static validators and golden tests, but have not yet been verified across all Unity (2022.3 / 6.x) and Godot (4.3–4.7) editor builds. Several advanced features are marked experimental (`[verify]`); see `docs/EXPORT_TARGETS.md` and `docs/KNOWN_ISSUES.md`.
- **Unity URP Deferred Pass:** Exported Unity Lit shaders use `UniversalForwardOnly` and do not yet emit a `UniversalGBuffer` deferred pass, DOTS instancing blocks, or Adaptive Probe Volumes (APV) pragmas.
- **HLSL Target:** Generic HLSL output is validated by static checks only and has not been verified against native `dxc`/`fxc` compilers.
- **Property Model:** `Texture2DArray`, `Texture3D`, `Cubemap`, `Gradient`, and `Curve` Blackboard property types are not yet implemented as exposed material parameters.
- **Theme Support:** The dark theme is the primary supported theme; the light theme is an incomplete preview skin.
