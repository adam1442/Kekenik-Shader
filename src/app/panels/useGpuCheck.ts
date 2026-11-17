import { useMemo } from "react";
import type { CompileResult } from "@/core";
import { getGl } from "@/webgl/context";
import { compileProgram } from "@/webgl/program";

export type GpuStatus =
  { state: "none" } | { state: "unavailable" } | { state: "ok"; warnings: string } | { state: "error"; log: string };

/** Compile + link the generated GLSL with this browser's real WebGL2 driver and report the info log. */
function checkOnGpu(result: CompileResult | null): GpuStatus {
  const vs = result?.files.find((f) => f.path === "shader.vert")?.content;
  const fs = result?.files.find((f) => f.path === "shader.frag")?.content;
  if (!vs || !fs) return { state: "none" };
  const h = getGl();
  if (!h) return { state: "unavailable" };
  const p = compileProgram(h.gl, vs, fs);
  if (!p.ok) return { state: "error", log: p.log };
  h.gl.deleteProgram(p.program);
  return { state: "ok", warnings: `${p.vertexLog}${p.fragmentLog}`.trim() };
}

export const useGpuCheck = (result: CompileResult | null): GpuStatus => useMemo(() => checkOnGpu(result), [result]);
