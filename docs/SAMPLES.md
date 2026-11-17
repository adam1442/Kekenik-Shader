# Kekenik Shader — Sample Library

39 showcase samples (16 × 3D / Lit, 12 × 2D / Sprites, 11 × VFX / Particles). Every sample is **generated** from TypeScript (`samples/**`) into `public/samples/<id>.kshader` + `public/samples/index.json` — never edit the `.kshader` files by hand.

```bash
node scripts/build-samples.mjs          # builds + verifies every sample, writes public/samples/*
node scripts/build-samples.mjs --only <id>
```

## Layout
| Path | Purpose |
|---|---|
| `samples/build/` | Builder DSL: `Sample` (properties, blocks, wires, portals, textures), `defineSubgraph`, auto-layout (columns = blocks, rows within a column), `emit.ts` (graph → `.kshader` + index entry), `check.ts` (static verification of sample graphs) |
| `samples/lib/` | Shared subgraph kits (`kit()` = one titled group + a note; memoised per id): Fresnel, Noise Stack, Soft Dissolve, Palette Ramp, Pixel Snap, Outline, Triplanar, Height Blend (2), Flow Sample, Gerstner Wave, Depth Intersection, Toon Light, Color Ramp (3 stops), Thin Film, Anisotropic Highlight, Height Blend (4 layers) |
| `samples/3d`, `samples/2d`, `samples/vfx` | One module per sample: `meta` (`SampleMeta`) + `build()`; registered in the folder's `index.ts` |
| `samples/textures/` | Seeded procedural textures (`gen.ts` fields / rock / water / palette / sprite; `gen-surface.ts` brick, terrain layers, lava crust, matcap; `gen-fx.ts` retro scene sprite, fire flipbook, smoke) → PNG (`png.ts`, zlib level 9, byte-deterministic) |
| `src/core/samples/` | `SampleMeta` / `SampleIndexEntry` schema, filter, budget, subgraph bundles |
| `src/app/samples/` | Sample Browser panel, details drawer, Welcome section, "Open as project" / "Insert as subgraph", thumbnails (`thumbs.ts`) |

## Conventions
* **Ids:** kebab-case file/id; 2D = `sprite-*`, VFX = `vfx-*`, 3D has no prefix. **Display order** = category, then difficulty (Beginner → Advanced), then registration order (`samples/build/index.ts`).
* **Every sample** has titled groups (one per technique block), a comment note per group (the math / the reason), portals for long wires, exposed parameters with **range, default, tooltip, header (category)**, HDR on emissive colors (linear), declared targets / required engine features / budget class, an embedded Preview config and procedural textures only.
* **Light direction** is a material parameter (Toon, Snow, Brushed Metal) — identical on every target; Godot has no main-light node in `fragment()`.
* **Scene resources** (Scene Color / Depth) ⇒ the sample declares only `glsl, unity, godot`, lists the required engine feature (`URP Depth Texture`, `URP Opaque Texture`) and enables the matching Preview simulation.
* **Thumbnails:** the Browser renders the node feeding Base Color; `thumbnailSlot: "emission"` overrides it (dark / flat albedo: Lava, Gem). If that node cannot be previewed (scene resources) the renderer falls back to upstream nodes (`representativeCandidates`).
* **Preview config** (`previewConfig`): `mode` 3d / 2d / vfx, mesh, lighting (`lit` must match the profile), camera, background, `intersector`, `emitter` (merged over the default emitter), `simulation` (depth / opaque texture), `nearest`.

## Adding a Sample
1. Create `samples/<group>/<name>.ts` exporting `meta` + `build()` and register it in the group's `index.ts`.
2. Run `node scripts/build-samples.mjs --only <id>` to validate and emit `public/samples/<id>.kshader`.
3. Run `node scripts/build-samples.mjs` to regenerate all samples and `public/samples/index.json`.
