# FIXLOG

## fixG — Godot "Unknown identifier in expression: 'INV_PROJECTION_MATRIX' / 'PROJECTION_MATRIX'" (Godot 4.7, Spatial)

**Report:** exporting the sample *Stylized Water (Gerstner, Foam, Refraction)* → Godot printed
`Error at line 59: … 'INV_PROJECTION_MATRIX'` and `Error at line 63: … 'PROJECTION_MATRIX'`.

**Reproduction (failing test first):** `tests/fixG.export-regression.test.ts` exports `public/samples/stylized-water.kshader` for `godot.spatial` / 4.7.
Before the fix lines 59 and 63 of the `.gdshader` were inside `vec4 ks_camera_params() { … }` (a global helper), reading `INV_PROJECTION_MATRIX` (line 59) and `PROJECTION_MATRIX` (line 63).

**Root cause (two defects):**
1. *Emission.* `ks.camera.params` / `ks.camera.nearFar` (used by Scene Depth / Linear Eye Depth / Depth Intersection …) were emitted from a hand-written Godot helper text (`GODOT_CAMERA_HELPER` in `core/engine/builtinEntries.ts`). The IR pass `lowerFunctionInputs` (E7) only lifts IR `input` ops; `engine` ops are resolved to raw text later, so built-ins inside engine templates were invisible to it. Official docs: only `TIME, PI, TAU, E, OUTPUT_IS_SRGB, CLIP_SPACE_FAR, IN_SHADOW_PASS` are global; every other built-in exists only inside `vertex()` / `fragment()` / `light()`.
2. *Validation.* `validate.ts` downgraded "built-in read inside a helper" to an `unverified` **warning**, and its scope tables were partly unverified, so the broken file was reported as exportable.

**Fix:**
- `core/ir/lowerEngine.ts` (new, E7b): every `engine` op inside a function whose Godot template reads non-global built-ins gets hidden parameters (`kek_b_<NAME>`); call sites pass the built-in from the processor function (`godot.builtin.<NAME>` engine op) or from the caller's hidden parameter (transitive).
- `GODOT_CAMERA_HELPER` now takes `(mat4 inv_proj, mat4 proj)`; `objectToClip` no longer uses the vertex-only `MODELVIEW_MATRIX`.
- `codegen/godot/pack.ts`: dependency detection (`godotEngineDeps`), argument substitution, stage-availability check (an engine template whose built-in does not exist in the current processor function is *unsupported*, never emitted).
- `codegen/godot/backend.ts`: canvas_item inputs without a 2D equivalent (`screenPos`, `faceSign`, `cameraPos`, `viewDir`, view/clip space) raise a clean unsupported diagnostic.
- Validator: `validateStrict.ts` + docs-pinned `data/builtinScopes.ts` — built-in outside its scope is now an **error** (`godot.builtin-out-of-scope`), plus unknown-function / arity / int-float / varying-flat / readonly checks.

**Other defects found on the way (fixed):** `vec3(saturate(x))` hid unknown functions (declaration detection ignored `(`); `CLEARCOAT_GLOSS` wrongly marked removed; canvas table lacked `SCREEN_PIXEL_SIZE`, `REGION_RECT`; function table lacked 30+ documented functions.

**Verification:** `npm test` → fixG suites. Sweep result: see `docs/EXPORT_MATRIX.md` (BROKEN = 0). Nothing here was compiled in Godot itself.

### Not verified against the real engine
`[verify]` entries remain warnings: `light()` table, `DEPTH` / reversed-Z behaviour of `hint_depth_texture` per renderer, `CURRENT_RENDERER` branch semantics, `hint_normal_roughness_texture` on non-Forward+.

### Remaining / follow-up
- Export dialog "Paste engine error" UI (core `knownErrors.ts` is done; mapping line → node via the code→node source map is not wired to the dialog).
- Unity / HLSL symbol-resolution pass and the same sweep for Unity / GLSL / WGSL (item 6).
- Node-attached diagnostics for the canvas_item input check (currently a backend-level message).
