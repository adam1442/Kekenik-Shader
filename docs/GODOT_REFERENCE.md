# Godot reference (facts used by the exporter and validator)

Source: official docs `docs.godotengine.org/en/stable/tutorials/shaders/shader_reference/` — `spatial_shader`, `canvas_item_shader`, `shader_functions`, `shader_preprocessor` (fetched 2026; pinned in `tests/fixtures/godot-docs.json`, test `fixG.scopes-match-docs`).

1. Not every built-in is available in every processing function. To use a vertex built-in in `fragment()` use a varying; the same for fragment → `light()`.
2. **Global built-ins** (usable everywhere incl. user functions): `TIME, PI, TAU, E, OUTPUT_IS_SRGB, CLIP_SPACE_FAR, IS_MULTIVIEW, IN_SHADOW_PASS`. Preprocessor defines `CURRENT_RENDERER, RENDERER_COMPATIBILITY, RENDERER_MOBILE, RENDERER_FORWARD_PLUS` are usable anywhere (`#if`). **Everything else exists only inside its processor function.** A helper that mentions one fails with `Unknown identifier in expression`.
3. Scope table (spatial; see `src/core/codegen/godot/data/builtinScopes.ts` for every row with type / access):

| Built-in | vertex() | fragment() | light() |
|---|---|---|---|
| `VIEW_MATRIX`, `INV_VIEW_MATRIX` | in | in | in |
| `PROJECTION_MATRIX` | **inout** | in | in |
| `INV_PROJECTION_MATRIX` | in | in | in |
| `MODEL_MATRIX`, `MODEL_NORMAL_MATRIX` | in | in | MODEL_MATRIX in |
| `MODELVIEW_MATRIX`, `MODELVIEW_NORMAL_MATRIX` | inout | – | – |
| `VIEWPORT_SIZE` | in | in | in |
| `VERTEX` | inout | in | – |
| `UV`, `UV2`, `COLOR` | inout | in | UV/UV2 in |
| `SCREEN_UV`, `FRAGCOORD`, `FRONT_FACING`, `VIEW` | – | in | SCREEN_UV, FRAGCOORD, VIEW in |
| `NODE_POSITION_WORLD`, `CAMERA_POSITION_WORLD` … | in | in | – |
4. `SCREEN_TEXTURE` / `DEPTH_TEXTURE` were removed: use `uniform sampler2D x : hint_screen_texture / hint_depth_texture / hint_normal_roughness_texture;`.
5. `canvas_item` has no 3D camera / projection matrices and no `FRONT_FACING`; such nodes are diagnosed as unsupported on that profile.
6. There is no implicit int↔float conversion; `saturate, frac, lerp, mul, fmod, rsqrt, atan2` do not exist (use `clamp(x, 0.0, 1.0)`, `fract, mix, *, mod, inversesqrt, atan(y, x)`). Integer varyings need `flat`.
7. `CLEARCOAT_GLOSS` (not `CLEARCOAT_ROUGHNESS`) is the clearcoat output.

## Validator rule ids
`godot.builtin-out-of-scope`, `godot.readonly-assign`, `godot.unknown-function`, `godot.unknown-identifier`, `godot.arity`, `godot.int-float-mix`, `godot.arg-type`, `godot.varying-int-needs-flat`, `godot.reserved-name`, `godot.removed-identifiers`, `godot.hints` (bad hint), `godot.render-mode`, plus the older structural rules. Errors fail the export report; `[verify]` facts are warnings.
