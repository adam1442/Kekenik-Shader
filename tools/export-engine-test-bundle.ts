/**
 * Maintainer tool: exports the canonical profile test graphs (and optionally sample library graphs)
 * to Unity URP (.shader) and Godot 4 (.gdshader) files on disk for manual verification inside
 * real Unity (2022.3 LTS / 6000.3 LTS) and Godot (4.3 / 4.7) editor projects.
 *
 * Usage (via Vite SSR loader so @/ path aliases and TypeScript work out of the box):
 *   node -e 'import("vite").then(async({createServer})=>{const s=await createServer({server:{middlewareMode:true},appType:"custom",logLevel:"error"});try{const m=await s.ssrLoadModule("/tools/export-engine-test-bundle.ts");await m.runCli(process.argv.slice(2));}finally{await s.close();}})'
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildBundle } from "../src/core/export/bundle";
import { PROFILE_TEST_GRAPHS } from "../src/core/profiles/testGraphs";

export interface EngineTestBundleSummary {
  outDir: string;
  bundleCount: number;
  fileCount: number;
  errors: string[];
}

export function generateEngineTestBundles(outDir = "engine-test-bundle"): EngineTestBundleSummary {
  const rootDir = resolve(process.cwd(), outDir);
  mkdirSync(rootDir, { recursive: true });

  const errors: string[] = [];
  let bundleCount = 0;
  let fileCount = 0;

  for (const spec of PROFILE_TEST_GRAPHS) {
    for (const profileId of spec.profiles) {
      const graph = spec.build(profileId);
      const bundle = buildBundle(graph, {
        unity: { enabled: true, profile: profileId, version: "6000.3" },
        godot: { enabled: true, version: "4.5" },
        glsl: { enabled: true },
        hlsl: { enabled: true },
        wgsl: { enabled: true },
      });

      const subDir = join(rootDir, `${spec.id}_${profileId.replace(/\./g, "_")}`);
      mkdirSync(subDir, { recursive: true });
      bundleCount++;

      for (const file of bundle.files) {
        const dest = join(subDir, file.path);
        mkdirSync(join(dest, ".."), { recursive: true });
        writeFileSync(dest, file.content, "utf8");
        fileCount++;
      }

      for (const rep of bundle.reports) {
        if (!rep.ok) {
          errors.push(`${spec.id} (${profileId}) [${rep.id}]: ${rep.problems.map((p) => p.message).join("; ")}`);
        }
      }
    }
  }

  const summaryMd = [
    "# Kekenik Shader — Engine Test Bundle",
    "",
    `Generated ${bundleCount} test bundles (${fileCount} files).`,
    "See `docs/ENGINE_TEST_PROTOCOL.md` for step-by-step Unity URP and Godot 4 verification instructions.",
    "",
  ].join("\n");
  writeFileSync(join(rootDir, "README.md"), summaryMd, "utf8");

  return { outDir: rootDir, bundleCount, fileCount, errors };
}

export async function runCli(args: string[]): Promise<void> {
  const outArg = args[0] || "engine-test-bundle";
  const res = generateEngineTestBundles(outArg);
  console.log(`Generated ${res.bundleCount} bundles (${res.fileCount} files) in ${res.outDir}`);
  if (res.errors.length > 0) {
    console.error("Validation errors:", res.errors);
    process.exitCode = 1;
  }
}
