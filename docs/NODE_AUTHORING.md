# Authoring a Node in Kekenik Shader

Every shader node in Kekenik Shader is a pure declarative `NodeDef` object registered in `src/core/nodes/`. Most nodes require fewer than 40 lines of TypeScript.

---

## 1. Minimal Example (`saturate`)

Append your node definition to the appropriate category module under `src/core/nodes/` (for example, `src/core/nodes/math.ts`) and ensure it is included in `CORE_NODE_DEFS` in `src/core/nodes/index.ts`:

```ts
import { defineNode, floatVec, sameAs } from "../registry/nodeDef";

export const saturateNode = defineNode({
  id: "saturate",
  category: "Math/Range",
  name: "Saturate",
  synonyms: ["clamp01"],
  description: "Clamps the input value to the [0, 1] range.",
  inputs: [{ id: "in", name: "In", type: floatVec("T"), default: 0 }],
  outputs: [{ id: "out", name: "Out", type: sameAs("in") }],
  build: (c) => ({
    out: c.b.intrinsic("saturate", [c.in("in")]),
  }),
});
```

---

## 2. `NodeDef` Reference

### Identity & Metadata
- **`id`**: Stable camelCase identifier (matching `^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$`). Never rename an existing ID without registering an alias in the node registry so saved `.kshader` files continue to load.
- **`category`**: Slash-separated category path shown in the Node Library and `Space` search (e.g. `"Math/Range"`, `"UV"`, `"Procedural/Noise"`, `"Shading/Lighting"`).
- **`name`**: Human-readable title displayed on the node header.
- **`synonyms`**: Optional array of search aliases (e.g. `["mix", "blend"]` for `Lerp`).
- **`description`**: Concise explanation shown in tooltips and the Inspector.

### Ports (`inputs` and `outputs`)
- **Concrete port types**: `T("float")`, `T("int")`, `T("bool")`, `T("vec2")`, `T("vec3")`, `T("vec4")`, `T("color")`, `T("color4")`, `T("mat2")`, `T("mat3")`, `T("mat4")`, `T("texture2D")`, `T("sampler")`.
- **Generic port groups**:
  - `numeric("T")`: Resolves across `float | int | vec2 | vec3 | vec4`.
  - `floatVec("T")`: Resolves across `float | vec2 | vec3 | vec4` (colors convert implicitly to `vec3`/`vec4`).
  - `sameAs("inPortId")`: Output port resolves to the inferred type of the referenced input port.
- **Defaults & Built-in Bindings**:
  - `default`: Default constant when the port is unconnected (numbers splat automatically onto vectors).
  - `defaultInput`: Automatically wires a stage built-in when unconnected, e.g. `defaultInput: { input: "uv0" }`.
  - `optional: true`: Allows an opaque port (such as a `sampler`) to remain unconnected; check `c.connected("samp")` inside `build(c)`.

### Node Parameters (`params`)
Non-port configuration settings (such as coordinate space dropdowns, boolean flags, or enum modes) are declared in `params`:
- `{ id: "space", name: "Space", type: "enum", default: "world", options: [{ value: "object", label: "Object" }, { value: "world", label: "World" }] }`
- Read parameter values inside `build(c)` via `c.param("space")`.

### Stage & Target Constraints
- **`stage`**: `"vertex"` | `"fragment"` | `"light"` (optional; defaults to any stage allowed by its IR operations).
- **`targets`**: Optional restriction or `targetNotes` when a node relies on engine-specific intrinsics (for example, Godot custom `light()` stage nodes).

---

## 3. Building IR Expressions (`BuildContext`)

The `build(c: BuildContext)` function returns a `Record<string, ExprId>` mapping each output port ID to an IR expression ID in the port's resolved storage type (`color` → `vec3`, `color4` → `vec4`).

- **`c.in("portId")`**: Returns the `ExprId` for an input port, already cast or converted to the port's resolved type.
- **`c.typeOf("portId")`**: Returns the resolved `ShaderType` of any input or output port.
- **`c.b` (`IRBuilder`)**:
  - Constants: `c.b.float(1)`, `c.b.int(0)`, `c.b.bool(true)`, `c.b.vec([x, y, z])`, `c.b.splat(type, scalarExpr)`
  - Arithmetic & Logic: `c.b.add(a, b)`, `c.b.sub(a, b)`, `c.b.mul(a, b)`, `c.b.div(a, b)`, `c.b.neg(a)`, `c.b.select(cond, t, f)`
  - Math Intrinsics: `c.b.intrinsic("sin", [x])`, `c.b.intrinsic("mix", [a, b, t])`, `c.b.intrinsic("dot", [a, b])`
  - Vectors & Matrices: `c.b.swizzle(v, "xy")`, `c.b.construct("vec3", [x, y, z])`, `c.b.matmul(m, v)`
  - Derivatives & Inputs: `c.b.deriv("ddx", x)`, `c.b.input("uv0")`, `c.b.input("normal", "world")`
- **Re-evaluating an Upstream Subtree (`cloneCone`)**:
  - For finite-difference nodes (such as *Height To Normal*), use `cloneCone` (`src/core/ir/clone.ts`) to re-evaluate an upstream expression cone with a Perturbed UV input rather than emitting duplicate helper functions.

---

## 4. Verification Checklist for New Nodes

1. Run `npm run typecheck` to confirm strict TypeScript types pass.
2. Run `npm run lint` and `npm run build`.
3. Launch `npm run dev`, press `Space` on the canvas, spawn your new node, and inspect its output in the **Preview** viewport and across all 5 targets in the **Code Output** panel (`GLSL`, `WGSL`, `HLSL`, `Unity URP`, `Godot 4`).
