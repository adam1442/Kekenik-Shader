# Known engine errors

Source: `src/core/engine/knownErrors.ts` (used by tests `fixG.known-errors.*`). Send new engine messages back verbatim — they become a row here and a validator rule.

| Engine | Message | Meaning | Fix |
|---|---|---|---|
| Godot | `Unknown identifier in expression: 'X'` | Built-in `X` is used where it does not exist (helper function / global initializer / wrong stage / canvas_item). Only TIME, PI, TAU, E, OUTPUT_IS_SRGB, CLIP_SPACE_FAR, IN_SHADOW_PASS are global. | Re-export with the current version; by hand pass `X` as a parameter or varying. Validator rule `godot.builtin-out-of-scope`. |
| Godot | `Invalid arguments for the built-in function: "f(…)"` | No overload; usually int vs float (`pow(2, x)`). | Write `2.0`, use `float(i)`. Rule `godot.int-float-mix`, `godot.arity`. |
| Godot | `Invalid operands … 'int' … 'float'` | No implicit int↔float conversion. | `1.0` instead of `1`. |
| Godot | unknown uniform hint | Hint not valid for the type / version. | See `data/hints.ts`; rule `godot.hints`. |
| Godot | `SCREEN_TEXTURE` / `DEPTH_TEXTURE` | Removed in Godot 4. | `uniform sampler2D t : hint_screen_texture;` |
| Unity | `undeclared identifier 'X'` | Missing include / newer URP API / use before definition. | Check version + includes. |
| Unity | `unrecognized identifier 'X'` | Unknown to the HLSL compiler. | Re-export for your Unity version. |
