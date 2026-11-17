# Kekenik Shader — Architecture

**Kekenik Shader** is a browser-based, engine-independent, node-based shader editor. A user authors one shader graph and exports it to **GLSL (WebGL2 / GLSL ES 3.00)**, **WGSL (WebGPU)**, **HLSL (Shader Model 5.0+)**, **Godot 4.x (`gdshader`)**, and **Unity URP (`ShaderLab + HLSL`)**.

## 1. Repository & Module Map

```text
src/
  core/             Pure TypeScript compiler core (no React, DOM, Three.js, dockview, or zustand).
                    Public entry point: src/core/index.ts
    types/          13 port types, semantic/space tags, 13×13 conversion table, generic type resolution
    values/         Pure value math (numbers, vectors, sRGB/linear color, gradients, curves, levels, identifiers)
    ir/             Hash-consed SSA expression DAG, 38 portable intrinsics, built-in inputs, stage legality,
                    function input lowering, slice/DCE, printer, deterministic CPU reference evaluator
    properties/     Blackboard Property & Keyword models, per-target reference name sanitization, manifest builder
    graph/          Immutable Graph & SubgraphDef models, invertible PatchOp operations, undo/redo history,
                    flatten pass (reroutes & portals), cycle & recursion detection
    registry/       NodeDef, PortDef, BuildContext, ProfileDef, NodeRegistry & ProfileRegistry
    compile/        Type inference (analyzeBody), IR construction (buildModule), global checks, compile pipeline
    nodes/          180+ node definitions (math, constants, inputs, procedural, visual, shading, info)
    custom/         Custom Function node specification, parser, and multi-target lowering
    profiles/       TargetProfile definitions, canonical master blocks, surface options, profile switching
    engine/         Cross-engine intrinsic map (scene depth/color/normals, camera, object, lighting, light stage)
    opt/            IR optimizer (levels 0–2), algebraic rules, CSE, range & precision analysis, hoist planner
    stats/          Instruction cost estimation, resource counts, performance hints
    bake/           CPU/GPU texture baking records and subgraph baking helpers
    layout/         Sugiyama-style automatic graph layout
    samples/        Sample metadata schema, filtering, and builder DSL
    codegen/        Target code generators and static validators:
      base/         Identifier mangling, reserved words, literal formatting, code writer, stage splitting
      dialect/      Shared C-style / WGSL / GLSL expression & function emitter
      glsl/         GLSL ES 3.00 vertex + fragment backend & preview surface bridge
      wgsl/         WebGPU WGSL backend
      hlsl/         Direct3D HLSL (SM 5.0+) backend & static checker
      unity/        Unity URP ShaderLab + HLSL multi-pass backend & static validators
      godot/        Godot 4.x gdshader backend & static validators
    export/         Multi-target bundle builder, README generator, and parameters.json manifest
    serialization/  Deterministic .kshader and .kshadersub JSON serialization, schema validation, migrations

  ui/
    controls/       Reusable desktop-grade value controls (NumberField, Slider, VecField, ColorField,
                    GradientEditor, CurveEditor, LevelsEditor, Select, Combobox, TextureSlot, Popover, etc.)
    graph/          Interactive node canvas (DOM node layer + HTML5 Canvas wire layer, viewport culling,
                    pan/zoom controller, Space search, portals, collapsible groups, comments, subgraphs)
    code/           CodeMirror 6 shader viewer and editor

  preview/          Three.js WebGL2 live preview viewport (3D meshes, 2D sprites, VFX CPU particle emitter,
                    Unity/Godot BRDF approximations, bloom/tone-mapping post-processing, custom asset loaders,
                    offscreen node thumbnail renderer)
  blackboard/       Blackboard panel, Inspector tabs (Node, Property, Keyword, Graph, Selection), Material panel
  validate/         In-browser WGSL validation via naga-wasm and optional WebGPU
  webgl/            Offscreen WebGL2 shader compilation & program validation
  app/              Application shell (dockview layout host, menu bar, toolbar, command palette, keybindings,
                    export dialog, bake dialog, optimizer report, benchmark, snapshots, preferences)
```

### Purity Boundary
- Everything under `src/core/**` is pure TypeScript with zero browser DOM, React, Three.js, or UI state dependencies.
- UI layers import core functionality through `@/core`.

---

## 2. Compilation Pipeline

```text
Graph (immutable JSON data)
  │
  ├─► globalChecks ............ duplicate property/keyword names (per target after sanitizing),
  │                             subgraph recursion checks
  ▼
flattenBody ................... resolves and removes structural nodes (reroute, portalIn, portalOut)
  │                             into direct edges while preserving UI path metadata (FlatEdge.via)
  ▼
analyzeBody ................... topological sort & cycle detection → reachability from Master Output
  │                             → port type inference (generic groups, sameAs, implicit conversions,
  │                             lossy truncation warnings, coordinate space checks, node.validate)
  ▼   (stops here if graph has blocking errors; unreachable node errors are downgraded to warnings)
targetAvailability ............ verifies every reachable NodeDef supports the active backend & profile
  ▼
buildModule ................... lowers reachable nodes in topological order into the SSA IR arena;
  │                             lowers reachable Subgraphs into IR functions (callee-first);
  │                             populates the expression-to-node source map
  ▼
checkStageLegality ............ validates vertex / fragment / light stage constraints for all outputs
  ▼
optPasses ..................... runs IR optimization passes (level 0: none, level 1: safe algebraic +
  │                             constant folding + CSE + DCE, level 2: fast-math) and function-input
  │                             lowering (for Godot helper functions reading stage built-ins)
  ▼
Backend.emit .................. generates target source files + static target validation diagnostics +
  │                             uniform binding table + parameter manifest
  ▼
CompileResult { ok, diagnostics, module, files, parameterManifest, timings, analysis }
```

---

## 3. Type System & Implicit Conversions

Kekenik Shader defines **13 port types**:
`float`, `int`, `bool`, `vec2`, `vec3`, `vec4`, `color`, `color4`, `mat2`, `mat3`, `mat4`, `texture2D`, `sampler`.

- `color` (RGB) and `color4` (RGBA) are distinct port types in the graph so the UI and exporters know whether a value represents a color (requiring sRGB/linear handling and color pickers) vs. a spatial vector. Inside the IR, `color` lowers to `vec3` storage and `color4` lowers to `vec4` storage.
- Port type constraints support concrete types (`T("vec3")`), generic numeric groups (`numeric("T")`), float/vector groups (`floatVec("T")`), and output derivation (`sameAs("inPortId")`).
- When multiple wires join a generic group (`joinTypes`), vectors win over scalars (scalars splat to the vector dimension), and the **smallest** vector dimension wins (wider vectors are truncated with a lossy-conversion warning, matching Unity Shader Graph's Dynamic Vector behavior).

### 13×13 Conversion Matrix (`src/core/types/conversion.ts`)

| From \ To | `float` | `int` | `bool` | `vec2` | `vec3` | `vec4` | `color` | `color4` | `mat*` / `tex` / `sampler` |
|---|---|---|---|---|---|---|---|---|---|
| **`float`** | `=` | `R⚠` | `R⚠` | `S` | `S` | `S` | `S` | `S` | `X` |
| **`int`** | `R` | `=` | `R⚠` | `S` | `S` | `S` | `S` | `S` | `X` |
| **`bool`** | `R` | `R` | `=` | `S` | `S` | `S` | `S` | `S` | `X` |
| **`vec2`** | `T⚠` | `X` | `X` | `=` | `P` | `P` | `P` | `P` | `X` |
| **`vec3`** | `T⚠` | `X` | `X` | `T⚠` | `=` | `P` | `R` | `P(α=1)` | `X` |
| **`vec4`** | `T⚠` | `X` | `X` | `T⚠` | `T⚠` | `=` | `T⚠` | `R` | `X` |
| **`color`** | `T⚠` | `X` | `X` | `T⚠` | `R` | `P` | `=` | `P(α=1)` | `X` |
| **`color4`** | `T⚠` | `X` | `X` | `T⚠` | `T⚠` | `R` | `T⚠` | `=` | `X` |
| **`mat*`, `texture2D`, `sampler`** | `X` | `X` | `X` | `X` | `X` | `X` | `X` | `X` | `=` (same type only) |

Legend: `=` exact match · `S` scalar splat · `T⚠` truncation (lossy warning) · `P` zero-pad (`α=1` when padding into `color4`) · `R` lossless reinterpret/cast · `R⚠` lossy scalar cast · `X` forbidden.  
The node canvas draws a two-color gradient wire whenever an implicit conversion (`S`, `T`, `P`, `R`) occurs on an edge.

---

## 4. Intermediate Representation (IR)

The IR (`src/core/ir/types.ts`) is a typed, hash-consed SSA expression DAG. Every body (`main` or a subgraph function) is an append-only array of expressions where **all operand IDs are strictly less than the expression ID** (guaranteeing topological order in a single forward pass).

| IR Op | Semantics |
|---|---|
| `const` | Flat numeric literal array (`bool` stored as `0`/`1`; matrices in column-major order) |
| `param` | Function parameter reference by index |
| `unary` | Component-wise negation (`neg`) or boolean negation (`not`) |
| `binary` | Arithmetic (`add`, `sub`, `mul`, `div`), comparison (`lt`, `le`, `gt`, `ge`, `eq`, `ne`), logical (`and`, `or`) |
| `intrinsic` | 38 portable math intrinsics (`sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `pow`, `exp`, `exp2`, `log`, `log2`, `sqrt`, `inversesqrt`, `abs`, `sign`, `floor`, `ceil`, `fract`, `round`, `trunc`, `mod`, `min`, `max`, `clamp`, `saturate`, `mix`, `step`, `smoothstep`, `radians`, `degrees`, `dot`, `cross`, `normalize`, `length`, `distance`, `reflect`, `refract`) |
| `construct` | Vector/matrix construction from scalars or smaller vectors |
| `swizzle` | Vector component swizzle (`xyzw` mask) |
| `select` | Ternary selection (`cond ? a : b`) |
| `cast` | Scalar type cast (`float` ↔ `int` ↔ `bool`) |
| `matmul` | Column-vector matrix multiplication (`M · v` or `M · M`) |
| `sample` | Texture sampling (`implicit` fragment-only, explicit `lod`, or explicit `grad`) |
| `textureSize` | Texture dimensions query (`vec2`) |
| `samplerState` | Inline filter/wrap sampler state |
| `deriv` | Screen-space partial derivatives (`ddx`, `ddy`, `fwidth` — fragment stage only) |
| `input` | Built-in stage inputs (`uv0`..`uv3`, `vertexColor`, `position`, `normal`, `tangent`, `bitangent`, `viewDir`, `time`, `deltaTime`, `screenPos`, `faceSign`, `vertexId`, `cameraPos`) with coordinate space |
| `uniform` | Exposed or internal Blackboard property / keyword selector |
| `call` | Subgraph function call (`fn`, `args`, output `index`); multi-output calls share one invocation |
| `custom` | Custom Function node call (`block`, `args`, output `index`) |
| `engine` | Engine-specific intrinsic template (`ks.light.*`, `ks.screen.*`, `ks.camera.*`, `ks.object.*`, `ks.sprite.*`, `ks.lightstage.*`) |

---

## 5. Cross-Target Convention Matrix

Backends adapt canonical IR operations using declarative `BackendTraits` (`src/core/ir/traits.ts`):

| Aspect | Canonical (IR) | GLSL (WebGL2) | HLSL | WGSL | Godot 4 | Unity URP |
|---|---|---|---|---|---|---|
| **UV Origin** | `(0,0)` bottom-left, `+V` up | Bottom-left | Top-left (optional flip flag) | Top-left (optional flip flag) | Top-left, `+V` down (meshes & textures match natively) | Bottom-left |
| **Matrix × Vector** | Column-vector `M · v`, column-major | `M * v` | `mul(M, v)`, row-major ctor transpose | `M * v` | `M * v` | `mul(M, v)`, row-major ctor transpose |
| **Clip-Space Z** | `[0, 1]` | `[-1, 1]` | `[0, 1]` | `[0, 1]` | `[0, 1]` (reversed-Z) | Engine macros (`UNITY_REVERSED_Z`) |
| **`mod(x, y)`** | Floor-mod: `x - y * floor(x / y)` | Native `mod(x, y)` | Emits floor-mod formula (`fmod` truncates) | Emits floor-mod formula (`%` truncates) | Native `mod(x, y)` | Emits floor-mod formula |
| **Scalar → Vec Ctor** | Single scalar splats | `vec3(x)` | Emits `float3(x, x, x)` | `vec3<f32>(x)` | `vec3(x)` | Emits `float3(x, x, x)` |
| **Mixed Scalar/Vec Intrinsics** | Allowed (`min(v, s)`) | Allowed | Allowed | Splat scalar first (`strictIntrinsicShapes`) | Allowed | Allowed |
| **Texture & Sampler** | Separate in IR | Combined `sampler2D` | Separate `Texture2D` + `SamplerState` | Separate `texture_2d<f32>` + `sampler` | Combined `sampler2D` with hints | `TEXTURE2D` + `SAMPLER` macros |

---

## 6. Key Design Decisions

| ID | Decision | Rationale |
|---|---|---|
| **D1** | **Separate `color` / `color4` port types, erased to `vec3` / `vec4` in IR** | Preserves color semantics for UI pickers, sRGB/linear conversion, and engine inspector hints (`[HDR]`, `source_color`) without duplicating vector operations in codegen. |
| **D2** | **Flat hash-consed SSA IR arena** | Guarantees topological ordering (`operand < exprId`), provides structural Common Subexpression Elimination (CSE) on construction, and simplifies optimization passes. |
| **D3** | **Invertible `PatchOp` graph history** | Every graph mutation compiles to a minimal key-path patch and its exact inverse, ensuring reliable undo/redo and structural sharing without full-graph cloning. |
| **D4** | **Groups and Comments as graph collections, Reroutes and Portals as flattened structural nodes** | Groups and comments never pollute the compiler graph; reroutes and wireless portals are resolved once in `flattenBody` before cycle detection and type inference. |
| **D5** | **Subgraphs compile to real shader functions** | Keeps generated shader code modular and readable while supporting multiple outputs via struct/out-parameter lowering. |
| **D6** | **Single GLSL backend powers both export and the live Three.js preview** | The preview uses the `surface: "preview"` emit mode of the real GLSL backend rather than a separate preview compiler, ensuring preview fidelity matches exported code. |
| **D7** | **Canonical Unity-style reference names (`_MainTex`) with per-target derivation** | Users edit one reference name; `targetReferenceName()` deterministically derives `u_Main_Tex` (GLSL/HLSL) and `main_tex` (WGSL/Godot) while escaping target reserved words. |
| **D8** | **Lowering stage built-ins into hidden function parameters on Godot** | Godot helper functions cannot access stage built-ins like `UV` or `NORMAL` directly; `lowerFunctionInputs` automatically threads them as `kek_in_*` parameters at every call site. |
