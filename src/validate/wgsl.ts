/**
 * WGSL validation outside the pure core (it needs WASM / the GPU).
 *
 *  1. `validateWgslNaga` — REAL parse + validation (types, address spaces, uniformity, entry points) by `naga-wasm`
 *     (the wgpu shader front-end compiled to WebAssembly). Works in every browser and in Node; no GPU needed.
 *  2. `validateWgslOnGpu` — `device.createShaderModule` + `getCompilationInfo()` when `navigator.gpu` exists.
 *
 * Choice (Decision Log D82): naga-wasm over `wgsl_reflect` (a parser only: no type checking) — it catches exactly the
 * mistakes a code generator makes (implicit conversions, abstract types, mixed vector shapes).
 */
interface WgslMessage {
  type: "error" | "warning" | "info";
  message: string;
  line?: number;
}
export interface WgslValidation {
  state: "ok" | "error" | "unavailable";
  messages: WgslMessage[];
  /** Which engine produced the verdict. */
  engine: "naga" | "webgpu";
  reason?: string;
}

interface NagaModule {
  init?: () => Promise<unknown>;
  parseWgsl(src: string): { free?: () => void };
  validate(m: unknown): { free?: () => void };
}

let nagaPromise: Promise<NagaModule | null> | null = null;

async function loadNaga(): Promise<NagaModule | null> {
  nagaPromise ??= (async () => {
    try {
      const mod = (await import("naga-wasm")) as unknown as NagaModule;
      if (typeof window !== "undefined" && typeof mod.init === "function") await mod.init();
      return mod;
    } catch {
      return null;
    }
  })();
  return nagaPromise;
}

const lineOf = (text: string): number | undefined => {
  const m = /wgsl:(\d+):(\d+)/.exec(text);
  return m ? Number(m[1]) : undefined;
};

/** Parse + validate with naga. */
export async function validateWgslNaga(src: string): Promise<WgslValidation> {
  const naga = await loadNaga();
  if (!naga)
    return {
      state: "unavailable",
      engine: "naga",
      messages: [],
      reason: "naga-wasm could not be loaded in this environment",
    };
  let module: { free?: () => void } | undefined;
  let info: { free?: () => void } | undefined;
  try {
    module = naga.parseWgsl(src);
    info = naga.validate(module);
    return { state: "ok", engine: "naga", messages: [] };
  } catch (e) {
    const err = e as { formatted?: string; message?: string };
    const text = err.formatted ?? err.message ?? String(e);
    const line = lineOf(text);
    return {
      state: "error",
      engine: "naga",
      messages: [
        {
          type: "error",
          message: text.split("\n")[0]!.replace(/^error:\s*/, ""),
          ...(line !== undefined ? { line } : {}),
        },
        { type: "info", message: text },
      ],
    };
  } finally {
    info?.free?.();
    module?.free?.();
  }
}

interface GpuLike {
  requestAdapter(): Promise<{ requestDevice(): Promise<GpuDevice> } | null>;
}
interface GpuDevice {
  createShaderModule(d: { code: string }): {
    getCompilationInfo(): Promise<{
      messages: Array<{ type: "error" | "warning" | "info"; message: string; lineNum: number }>;
    }>;
  };
  destroy?: () => void;
}

const hasWebGpu = (): boolean => typeof navigator !== "undefined" && !!(navigator as unknown as { gpu?: unknown }).gpu;

/** Compile with the browser's WebGPU implementation (`createShaderModule` + `getCompilationInfo`). */
export async function validateWgslOnGpu(src: string): Promise<WgslValidation> {
  if (!hasWebGpu())
    return {
      state: "unavailable",
      engine: "webgpu",
      messages: [],
      reason: "navigator.gpu is not available in this browser",
    };
  try {
    const gpu = (navigator as unknown as { gpu: GpuLike }).gpu;
    const adapter = await gpu.requestAdapter();
    if (!adapter)
      return {
        state: "unavailable",
        engine: "webgpu",
        messages: [],
        reason: "WebGPU is present but no adapter was returned",
      };
    const device = await adapter.requestDevice();
    const info = await device.createShaderModule({ code: src }).getCompilationInfo();
    device.destroy?.();
    const messages = info.messages.map((m): WgslMessage => ({ type: m.type, message: m.message, line: m.lineNum }));
    return { state: messages.some((m) => m.type === "error") ? "error" : "ok", engine: "webgpu", messages };
  } catch (e) {
    return { state: "unavailable", engine: "webgpu", messages: [], reason: `WebGPU failed: ${(e as Error).message}` };
  }
}
