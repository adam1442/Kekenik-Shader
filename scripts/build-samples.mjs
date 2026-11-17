// Regenerates public/samples/*.kshader + index.json from samples/** (Builder DSL), verifying every sample first.
// Usage: node scripts/build-samples.mjs [--no-check] [--only <id>]
import { createServer } from "vite";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";

const noCheck = process.argv.includes("--no-check");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > 0 ? process.argv[onlyIdx + 1] : null;
const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
let failed = false;
try {
  const { emitAll } = await server.ssrLoadModule("/samples/build/index.ts");
  const { checkSample } = await server.ssrLoadModule("/samples/build/check.ts");
  const { files, index } = emitAll();
  mkdirSync("public/samples", { recursive: true });
  for (const f of readdirSync("public/samples")) if (f.endsWith(".kshader") && !files.some((x) => x.file === f)) rmSync(`public/samples/${f}`);
  for (const f of files) {
    if (only && f.entry.id !== only) continue;
    const problems = noCheck ? [] : checkSample(f.graph, f.entry);
    if (problems.length) { failed = true; console.log(`✗ ${f.entry.id}\n   ${problems.join("\n   ")}`); }
    else console.log(`✓ ${f.entry.id}  ${f.entry.nodes} nodes · ${f.entry.groups} groups · ${f.entry.subgraphs.length} subgraphs · ${(f.text.length / 1024).toFixed(0)} KB`);
    writeFileSync(`public/samples/${f.file}`, f.text);
  }
  writeFileSync("public/samples/index.json", JSON.stringify(index, null, 2) + "\n");
  console.log(`wrote ${files.length} samples + index.json`);
} catch (e) { console.error(e); failed = true; } finally { await server.close(); }
process.exitCode = failed ? 1 : 0;
