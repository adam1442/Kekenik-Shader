import { useEffect, useState } from "react";
import { type CompileResult, checkHlsl } from "@/core";
import { validateWgslNaga, validateWgslOnGpu } from "@/validate/wgsl";
import type { CodeTarget } from "../../shaderStore";

export interface TargetCheck {
  state: "none" | "pending" | "ok" | "error" | "static-ok" | "static-error";
  label: string;
  messages: string[];
}
const NONE: TargetCheck = { state: "none", label: "", messages: [] };

/** WGSL: naga-wasm validation (+ WebGPU when present). HLSL: static checks only (never claimed as compiled). */
export function useTargetCheck(target: CodeTarget, result: CompileResult | null): TargetCheck {
  const [check, setCheck] = useState<TargetCheck>(NONE);
  const text = result?.ok ? (result.files[0]?.content ?? "") : "";
  useEffect(() => {
    if (!text || (target !== "wgsl" && target !== "hlsl")) return setCheck(NONE);
    if (target === "hlsl") {
      const c = checkHlsl(text);
      return setCheck(
        c.ok
          ? { state: "static-ok", label: "static checks OK (not compiled)", messages: [] }
          : {
              state: "static-error",
              label: "static check failed",
              messages: c.issues.map((i) => `line ${i.line}: ${i.message}`),
            },
      );
    }
    let alive = true;
    setCheck({ state: "pending", label: "validating…", messages: [] });
    void (async () => {
      const naga = await validateWgslNaga(text);
      const gpu = await validateWgslOnGpu(text);
      if (!alive) return;
      const msgs = [...naga.messages, ...gpu.messages]
        .filter((m) => m.type === "error")
        .map((m) => `${m.line ? `line ${m.line}: ` : ""}${m.message}`);
      const engines = [naga.state === "ok" ? "naga" : "", gpu.state === "ok" ? "WebGPU" : ""]
        .filter(Boolean)
        .join(" + ");
      if (naga.state === "error" || gpu.state === "error")
        setCheck({ state: "error", label: "WGSL invalid", messages: msgs });
      else if (naga.state === "ok" || gpu.state === "ok")
        setCheck({ state: "ok", label: `valid WGSL (${engines})`, messages: [] });
      else setCheck({ state: "none", label: "validation unavailable", messages: [] });
    })();
    return () => {
      alive = false;
    };
  }, [text, target]);
  return check;
}
