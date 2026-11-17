import { getGl } from "./context";
import { compileProgram } from "./program";
import { type UniformSetter, setHostDefaults } from "./gpuRunner";

/**
 * GPU benchmark : renders N full-screen passes of a generated shader pair into an offscreen RGBA8 target and times them.
 * Timing source: `EXT_disjoint_timer_query_webgl2` (GPU time, reliable) when present, otherwise a fenced `performance.now()` loop
 * (`readPixels` forces completion; browsers coarsen the clock, so `reliable` is false). Results are RELATIVE numbers for THIS GPU and
 * driver only — never compare them across machines and never read them as engine frame times.
 */
export interface BenchOptions {
  vertex: string;
  fragment: string;
  /** Square render-target size in pixels (default 512). */
  size?: number;
  /** Full-screen passes per timed sample (default 24; the fenced path raises it until a sample lasts ≥ 25 ms). */
  passes?: number;
  /** Timed samples; the median is reported (default 5). */
  samples?: number;
  /** Extra uniform assignments (property defaults); host built-ins are always set. */
  setUniforms?: UniformSetter;
}
export interface BenchResult {
  ok: boolean;
  log: string;
  /** Median milliseconds per full-screen pass (0 when !ok). */
  msPerPass: number;
  method: "timer-query" | "fenced";
  /** true only for GPU timer queries. */
  reliable: boolean;
  /** Per-sample ms/pass, in run order. */
  samples: number[];
  size: number;
}

const fail = (log: string, size: number): BenchResult => ({
  ok: false,
  log,
  msPerPass: 0,
  method: "fenced",
  reliable: false,
  samples: [],
  size,
});
const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h]! : (s[h - 1]! + s[h]!) / 2;
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function benchShader(o: BenchOptions): Promise<BenchResult> {
  const size = o.size ?? 512;
  const h = getGl();
  if (!h) return fail("WebGL2 is not available", size);
  const gl = h.gl;
  const pr = compileProgram(gl, o.vertex, o.fragment);
  if (!pr.ok || !pr.program) return fail(pr.log, size);
  const program = pr.program;
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null;
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const dummy = gl.createTexture()!; // unit 0 must not be the render target (feedback loop)
  gl.bindTexture(gl.TEXTURE_2D, dummy);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
  const vao = gl.createVertexArray()!;
  const buf = gl.createBuffer()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.vertexAttrib3f(1, 0, 0, 1);
  gl.vertexAttrib2f(2, 0.25, 0.75);
  gl.vertexAttrib4f(3, 1, 1, 1, 1);
  gl.vertexAttrib4f(4, 1, 0, 0, 1);
  for (let i = 5; i <= 7; i++) gl.vertexAttrib2f(i, 0.5, 0.5);

  const samples: number[] = [];
  let log = "";
  const px = new Uint8Array(4);
  try {
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error("framebuffer incomplete");
    gl.useProgram(program);
    const loc = (n: string) => gl.getUniformLocation(program, n);
    setHostDefaults(gl, loc);
    o.setUniforms?.(gl, loc);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.viewport(0, 0, size, size);
    const draw = (n: number): void => {
      for (let i = 0; i < n; i++) gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    draw(2);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // warm-up: driver compiles lazily
    const err = gl.getError();
    if (err !== gl.NO_ERROR) throw new Error(`GL error 0x${err.toString(16)}`);
    let passes = Math.max(1, o.passes ?? 24);
    const count = Math.max(1, o.samples ?? 5);
    if (!ext) {
      // fenced: grow the batch until one sample is long enough for the coarse clock
      for (let k = 0; k < 8; k++) {
        const t = performance.now();
        draw(passes);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        if (performance.now() - t >= 25 || passes >= 4096) break;
        passes *= 2;
      }
    }
    for (let s = 0; s < count; s++) {
      if (ext) {
        const q = gl.createQuery()!;
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        draw(passes);
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        let waited = 0;
        while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && waited < 2000) {
          await sleep(4);
          waited += 4;
        }
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
        if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && !disjoint)
          samples.push((gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6 / passes);
        gl.deleteQuery(q);
      } else {
        const t = performance.now();
        draw(passes);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        samples.push((performance.now() - t) / passes);
      }
      await sleep(0); // let the browser breathe between samples
    }
    if (samples.length === 0) throw new Error("no valid timing sample (timer query disjoint)");
  } catch (e) {
    log = (e as Error).message;
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    gl.deleteVertexArray(vao);
    gl.deleteBuffer(buf);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    gl.deleteTexture(dummy);
    gl.deleteProgram(program);
  }
  if (log) return { ...fail(log, size), method: ext ? "timer-query" : "fenced", reliable: false };
  return {
    ok: true,
    log: "",
    msPerPass: median(samples),
    method: ext ? "timer-query" : "fenced",
    reliable: !!ext,
    samples,
    size,
  };
}
