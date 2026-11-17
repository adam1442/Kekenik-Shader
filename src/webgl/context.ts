/**
 * Hidden WebGL2 context used for shader validation and GPU read-back (Code panel "compiles on this GPU", preview and
 * thumbnail shader validation). Not part of the pure core: it needs a DOM / OffscreenCanvas.
 *
 * Browsers cap the number of live WebGL contexts (Chrome: 16) and silently LOSE the OLDEST one when it is exceeded — and this is the
 * oldest context of the page. A lost context compiles nothing (empty shader info logs), so `getGl()` re-creates it when it was lost
 * instead of caching a dead handle for the rest of the session.
 */
let cached: { gl: WebGL2RenderingContext | null; floatTargets: boolean } | undefined;

export interface GlHandle {
  gl: WebGL2RenderingContext;
  /** RGBA32F render targets are available (EXT_color_buffer_float). */
  floatTargets: boolean;
}

function create(): { gl: WebGL2RenderingContext | null; floatTargets: boolean } {
  let gl: WebGL2RenderingContext | null = null;
  try {
    const canvas: HTMLCanvasElement | OffscreenCanvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(8, 8)
        : Object.assign(document.createElement("canvas"), { width: 8, height: 8 });
    gl = canvas.getContext("webgl2", {
      antialias: false,
      preserveDrawingBuffer: true,
    }) as WebGL2RenderingContext | null;
  } catch {
    gl = null;
  }
  return { gl, floatTargets: !!gl?.getExtension("EXT_color_buffer_float") };
}

export function getGl(): GlHandle | null {
  if (cached?.gl?.isContextLost()) {
    cached = create();
  }
  if (!cached) cached = create();
  return cached.gl ? { gl: cached.gl, floatTargets: cached.floatTargets } : null;
}

export const hasWebGl2 = (): boolean => getGl() !== null;
