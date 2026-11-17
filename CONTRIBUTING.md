# Contributing to Kekenik Shader

Thank you for your interest in contributing to **Kekenik Shader**! Whether you are fixing a bug, verifying exported shaders in Unity URP or Godot 4, authoring a new shader node, or improving documentation, your contributions are welcome.

---

## 1. Development Setup

### Prerequisites
- **Node.js `>= 20`** (see [`.nvmrc`](.nvmrc))
- **npm** (uses `package-lock.json`)
- A modern desktop browser with **WebGL2** enabled (and optionally **WebGPU**)

### Install & Start the Dev Server

```bash
git clone https://github.com/adam1442/kekenik-shader.git
cd kekenik-shader
npm ci
npm run dev
```

---

## 2. NPM Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start the Vite development server with hot module replacement |
| `npm run build` | Build the production bundle into `dist/` |
| `npm run preview` | Serve the production `dist/` folder locally |
| `npm run typecheck` | Run strict TypeScript type checking (`tsc --noEmit`) |
| `npm run lint` | Run ESLint static analysis over `src/` |
| `npm run format` | Format source files in `src/` with Prettier |
| `npm run format:check` | Check formatting in `src/` with Prettier |

### Maintainer Utility Scripts
- `node scripts/build-samples.mjs` — Regenerates `public/samples/*.kshader` and `public/samples/index.json` from the TypeScript builder DSL in `samples/`.
- `node scripts/gen-licenses.mjs` — Regenerates `src/app/pro/licenses.generated.ts` and `THIRD_PARTY_LICENSES.md` from `node_modules` and fails if any copyleft dependency is introduced.

---

## 3. Architecture & Code Style Guidelines

Please read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before making structural changes:

1. **Core Purity (`src/core/**`):**
   - `src/core` must remain 100% pure TypeScript with **zero** imports from React, DOM APIs, Three.js, `dockview`, or `zustand`.
   - UI components import core types and functions through `@/core`.
2. **TypeScript Strictness:**
   - The project compiles with `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`, and `noFallthroughCasesInSwitch: true`.
3. **UI Controls (`src/ui/controls/**`):**
   - Value-editing UI must use the shared controls in `@/ui/controls` (see [`docs/CONTROLS.md`](docs/CONTROLS.md)) so live `onChange` and per-gesture `onCommit` undo semantics work consistently.
4. **Deterministic Serialization & Exports:**
   - `.kshader`, `.kshadersub`, and exported `.zip` archives must remain byte-deterministic for identical inputs.

---

## 4. How to Add a Shader Node

See [`docs/NODE_AUTHORING.md`](docs/NODE_AUTHORING.md) for a complete step-by-step example:

1. Define the `NodeDef` using `defineNode({ id, category, name, synonyms, description, inputs, outputs, build })` in the appropriate module under `src/core/nodes/`.
2. Register the node in `CORE_NODE_DEFS` (`src/core/nodes/index.ts`).
3. Verify the node in the live **Preview** viewport and check the generated code across all 5 targets (`GLSL`, `WGSL`, `HLSL`, `Unity URP`, `Godot 4`) in the **Code Output** panel.

---

## 5. Running the Engine Verification Bundle Generator

To generate a complete folder of exported Unity URP (`.shader`) and Godot 4 (`.gdshader`) test shaders from the canonical profile test graphs (`tools/export-engine-test-bundle.ts`):

```bash
node -e 'import("vite").then(async({createServer})=>{const s=await createServer({server:{middlewareMode:true},appType:"custom",logLevel:"error"});try{const m=await s.ssrLoadModule("/tools/export-engine-test-bundle.ts");await m.runCli(["/tmp/kekenik-engine-tests"]);}finally{await s.close();}})'
```

Then follow the step-by-step verification checklist in [`docs/ENGINE_TEST_PROTOCOL.md`](docs/ENGINE_TEST_PROTOCOL.md).

---

## 6. GitHub Pages Deployment Setup (Maintainers)

Deployment to `https://adam1442.github.io/kekenik-shader/` is automated via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) on push to `main`.  
One manual repository setting is required once on GitHub:
- Navigate to **Repository Settings → Pages → Build and deployment → Source** and select **"GitHub Actions"**.

---

## 7. Pull Request Checklist

Before opening a Pull Request, please ensure:
- [ ] `npm run typecheck` passes with 0 errors.
- [ ] `npm run lint` passes with 0 errors.
- [ ] `npm run build` succeeds cleanly.
- [ ] If you added or updated production dependencies, you ran `node scripts/gen-licenses.mjs` and confirmed no copyleft (`GPL`/`LGPL`/`AGPL`) packages were introduced.
- [ ] If you modified sample definitions in `samples/`, you ran `node scripts/build-samples.mjs`.
- [ ] Your changes follow the [Code of Conduct](CODE_OF_CONDUCT.md).
