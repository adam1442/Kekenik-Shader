import { type Diagnostic, makeDiagnostic } from "@/core";
import type { LineEntry } from "@/core/codegen/base/writer";

/** One parsed line of a WebGL info log. */
interface GlLogEntry {
  stage: "vertex" | "fragment" | "link";
  /** 1-based generated line (absent for link errors). */
  line?: number;
  message: string;
}

const STAGE_FILE = { vertex: "shader.vert", fragment: "shader.frag" } as const;

/**
 * Parse the log produced by `webgl/program.compileProgram` (`vertex shader: ERROR: 0:12: …` blocks, `link: …`).
 * Only ERROR lines are returned (warnings from drivers are noise in the preview).
 */
function parseGlLog(log: string): GlLogEntry[] {
  const out: GlLogEntry[] = [];
  let stage: GlLogEntry["stage"] = "fragment";
  for (const raw of log.split("\n")) {
    let line = raw.trim();
    if (!line) continue;
    const head = /^(vertex shader|fragment shader|link):\s*/i.exec(line);
    if (head) {
      stage = head[1]!.toLowerCase().startsWith("vertex")
        ? "vertex"
        : head[1]!.toLowerCase().startsWith("fragment")
          ? "fragment"
          : "link";
      line = line.slice(head[0].length);
    }
    const m = /^ERROR:\s*\d+:(\d+):\s*(.*)$/i.exec(line);
    if (m) out.push({ stage, line: Number(m[1]), message: m[2]!.trim() });
    else if (stage === "link" || /^ERROR:/i.test(line)) out.push({ stage, message: line.replace(/^ERROR:\s*/i, "") });
  }
  return out;
}

/** Generated line → originating node: exact entry, otherwise the nearest earlier entry within `reach` lines. */
function nodeAtLine(table: readonly LineEntry[] | undefined, line: number, reach = 4): LineEntry | undefined {
  if (!table) return undefined;
  let best: LineEntry | undefined;
  for (const e of table) {
    if (e.line === line) return e;
    if (e.line < line && line - e.line <= reach && (!best || e.line > best.line)) best = e;
  }
  return best;
}

/** Turn a driver log into graph diagnostics (E_BACKEND_FAILED) attached to the node that generated the failing line. */
export function mapGpuErrors(log: string, sourceLines: Record<string, LineEntry[]> | undefined): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const e of parseGlLog(log)) {
    const ref =
      e.stage !== "link" && e.line !== undefined ? nodeAtLine(sourceLines?.[STAGE_FILE[e.stage]], e.line) : undefined;
    const where = e.line !== undefined ? ` (${e.stage} line ${e.line})` : e.stage === "link" ? " (link)" : "";
    const d = makeDiagnostic(
      "E_BACKEND_FAILED",
      `GPU: ${e.message}${where}`,
      ref
        ? {
            nodeId: ref.nodeId,
            ...(ref.portId ? { portId: ref.portId } : {}),
            ...(ref.scope ? { scope: ref.scope } : {}),
          }
        : {},
    );
    const key = `${d.nodeId ?? ""}|${d.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(d);
    }
  }
  if (out.length === 0 && log.trim()) out.push(makeDiagnostic("E_BACKEND_FAILED", `GPU: ${log.trim().slice(0, 300)}`));
  return out;
}
