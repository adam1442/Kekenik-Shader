# Target Profiles — Extension Guide ("How to Add a Target Profile / Engine")

This guide describes how target profiles and engine backends are structured in Kekenik Shader.

## Layers
| Layer | Location | Role |
|---|---|---|
| Profile data | `src/core/profiles/types.ts`, `src/core/profiles/<engine>/*` | `TargetProfile` = blocks + surface options + versions (pure data, no codegen imports) |
| Registry | `src/core/profiles/registry.ts` | `targetProfiles` (data) + `toProfileDef()` → IR `ProfileDef` (registered in `defaultProfileRegistry` by `profiles/index.ts`) |
| Switching | `src/core/profiles/switch.ts` | `planProfileSwitch(graph, toId) → {ops, problems}`, `switchProfile` (pure apply) |
| Backend | `src/core/codegen/<engine>/` | a `Backend` (`id`, `traits`, `emit`) — e.g. `unityBackend` + `compileUnity(graph)` |
| Export | `src/core/export/registry.ts` | `ExportTarget {id,label,extension,generate,readmeSection,manifestExtras}`; `registerExportTarget` |
| Validators | `src/core/codegen/<engine>/validate*.ts` | pure functions over generated text → `ProfileProblem[]` |

## Canonical Block IDs (Shared by All Engines)
`positionOS normalOS tangentOS` (vertex) · `baseColor alpha alphaClipThreshold normalTS metallic smoothness occlusion emission translucency thickness spriteMask` (fragment). Engines map them to their native outputs (e.g. Godot maps `ROUGHNESS = 1.0 - smoothness`). Block IDs are the master-node port IDs and the IR output slots.

## Steps to Add an Engine or Profile
1. **Profiles**: create `src/core/profiles/<engine>/index.ts` exporting `TargetProfile[]` (use `block(id, required, shownWhen?)` from `canonical.ts`). Register them in `src/core/profiles/index.ts` (`targetProfiles.register` + `toProfileDef`).
2. **Options**: surface options are stored under their option ID in `graph.settings` (default = `SurfaceOptionDef.default`, stored value removed when equal to the default). `shownWhen` blocks are skipped in `buildModule` when inactive (wires are preserved).
3. **Backend**: reuse `src/core/codegen/dialect/generate.ts` (`generate(module, pack, opts)` produces `vertex.core/pos/slotExprs`, `fragment.body/slotExprs/varyings`, `functions`, `helpers`). Write a `LangPack` (+ dialect wrapper) and an assembler. `sliceModule(module, slots)` (`src/core/ir/slice.ts`) provides per-pass dead-code elimination. Engine intrinsics come from `src/core/engine/builtinEntries.ts`.
4. **Validators**: pure `(text, ctx) → ProfileProblem[]` with rule IDs `<engine>.<rule>`.
5. **Export Target**: call `registerExportTarget({...})` in `src/core/export/registry.ts` and wire the target into `src/core/export/bundle.ts`.
6. **Code Output Panel**: add the target to `CODE_TARGETS` (`src/app/shaderStore.ts`) and compile it in `CodeOutputPanel.tsx`.
