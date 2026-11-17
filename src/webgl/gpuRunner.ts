import { getGl } from "./context";
import { compileProgram } from "./program";

/** One uniform assignment performed before a draw. */
export type UniformSetter = (gl: WebGL2RenderingContext, loc: (name: string) => WebGLUniformLocation | null) => void;

interface RunOptions {
  vertex: string;
  fragment: string;
  /** Number of pixels (rows) to render: pixel i is drawn after `rows[i]` set its uniforms. */
  rows: UniformSetter[];
  /** Force the RGBA8 bit-pattern read-back path even if float targets exist (tests the fallback). */
  forceBytes?: boolean;
  /** Draw the triangle clockwise (a back face: `gl_FrontFacing` is false) — simulates seeing a double-sided plane from behind. */
  reverseWinding?: boolean;
}

interface RunResult {
  ok: boolean;
  log: string;
  /** rows × 4 floats (RGBA). */
  data: Float32Array;
  mode: "float" | "bytes";
}

const IDENTITY4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Sets every host uniform the generated shaders may declare (identity matrices, camera at +Z, time 0). */
export function setHostDefaults(gl: WebGL2RenderingContext, loc: (n: string) => WebGLUniformLocation | null): void {
  for (const m of ["ks_Model", "ks_View", "ks_Projection", "ks_WorldToObject", "ks_ViewInverse"]) {
    const l = loc(m);
    if (l) gl.uniformMatrix4fv(l, false, IDENTITY4);
  }
  const nm = loc("ks_NormalMatrix");
  if (nm) gl.uniformMatrix3fv(nm, false, IDENTITY3);
  const cam = loc("ks_CameraPos");
  if (cam) gl.uniform3f(cam, 0, 0, 5);
  for (const [n, v] of [["ks_ProjectionInverse", IDENTITY4]] as const) {
    const l = loc(n);
    if (l) gl.uniformMatrix4fv(l, false, v);
  }
  const v4 = (n: string, a: number, b: number, c: number, d: number): void => {
    const l = loc(n);
    if (l) gl.uniform4f(l, a, b, c, d);
  };
  v4("ks_CameraParams", 0.1, 100, 0, 0);
  v4("ks_ScreenParams", 1, 1, 1, 1);
  v4("ks_FogColor", 0, 0, 0, 1);
  v4("ks_FogParams", 0, 0, 100, 0);
  v4("ks_SpriteRect", 0, 0, 1, 1);
  v4("ks_SpriteInfo", 1, 1, 100, 0);
  for (const [n, a, b, c] of [
    ["ks_MainLightDir", 0, 1, 0],
    ["ks_MainLightColor", 1, 1, 1],
    ["ks_AmbientColor", 0, 0, 0],
  ] as const) {
    const l = loc(n);
    if (l) gl.uniform3f(l, a, b, c);
  }
  for (const [n, v] of [
    ["ks_Time", 0],
    ["ks_DeltaTime", 0.016],
    ["ks_SmoothDeltaTime", 0.016],
  ] as const) {
    const l = loc(n);
    if (l) gl.uniform1f(l, v);
  }
}

/** Patch a generated fragment shader so one color channel is written as raw IEEE-754 bits in RGBA8. */
function patchFragmentForBytes(src: string): string {
  const declared = src.replace(
    "out vec4 ks_FragColor;",
    "vec4 ks_Result;\nuniform int ks_Channel;\nout vec4 ks_FragColor;",
  );
  const renamed = declared.replace(/ks_FragColor = /g, "ks_Result = "); // assignments only: the `out` declaration keeps its name
  const end = renamed.lastIndexOf("}");
  const pack =
    "    uint ks_bits = floatBitsToUint(ks_Result[ks_Channel]);\n" +
    "    ks_FragColor = vec4(float(ks_bits & 255u), float((ks_bits >> 8u) & 255u), float((ks_bits >> 16u) & 255u), float(ks_bits >> 24u)) / 255.0;\n";
  return renamed.slice(0, end) + pack + renamed.slice(end);
}

/**
 * Render `rows.length` pixels of a generated shader pair (full-screen triangle, identity matrices) and read back exact floats.
 * Float path: RGBA32F framebuffer. Byte path: four passes that store each channel's bits in RGBA8.
 */
export function runShader(opts: RunOptions): RunResult {
  const h = getGl();
  const n = opts.rows.length;
  if (!h) return { ok: false, log: "WebGL2 is not available", data: new Float32Array(0), mode: "float" };
  const { gl } = h;
  const mode: "float" | "bytes" = h.floatTargets && !opts.forceBytes ? "float" : "bytes";
  const frag = mode === "bytes" ? patchFragmentForBytes(opts.fragment) : opts.fragment;
  const pr = compileProgram(gl, opts.vertex, frag);
  if (!pr.ok || !pr.program) return { ok: false, log: pr.log, data: new Float32Array(n * 4), mode };
  const program = pr.program;

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (mode === "float") gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, n, 1, 0, gl.RGBA, gl.FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, n, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  // Unit 0 must NOT keep the render target bound: a generated `sampler2D` defaults to unit 0, and sampling the texture
  // being rendered to is a feedback loop (GL_INVALID_OPERATION on draw). Give every sampler a defined 1×1 mid-grey texel instead.
  const dummy = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, dummy);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  const vao = gl.createVertexArray()!;
  const buf = gl.createBuffer()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array(opts.reverseWinding ? [-1, -1, 0, -1, 3, 0, 3, -1, 0] : [-1, -1, 0, 3, -1, 0, -1, 3, 0]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  // Constant values for the other attributes (disabled arrays): normal +Z, uv (0.25, 0.75), color white, tangent +X.
  gl.vertexAttrib3f(1, 0, 0, 1);
  gl.vertexAttrib2f(2, 0.25, 0.75);
  gl.vertexAttrib4f(3, 1, 1, 1, 1);
  gl.vertexAttrib4f(4, 1, 0, 0, 1);
  for (let i = 5; i <= 7; i++) gl.vertexAttrib2f(i, 0.5, 0.5);

  const data = new Float32Array(n * 4);
  let error = "";
  try {
    if (!complete) throw new Error("framebuffer incomplete");
    gl.useProgram(program);
    const loc = (name: string) => gl.getUniformLocation(program, name);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    const channels = mode === "float" ? 1 : 4;
    const bytes = new Uint8Array(n * 4);
    for (let ch = 0; ch < channels; ch++) {
      gl.clearColor(0, 0, 0, 0);
      gl.viewport(0, 0, n, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (mode === "bytes") gl.uniform1i(loc("ks_Channel"), ch);
      for (let i = 0; i < n; i++) {
        setHostDefaults(gl, loc);
        if (mode === "bytes") gl.uniform1i(loc("ks_Channel"), ch);
        opts.rows[i]!(gl, loc);
        gl.viewport(i, 0, 1, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      if (mode === "float") gl.readPixels(0, 0, n, 1, gl.RGBA, gl.FLOAT, data);
      else {
        gl.readPixels(0, 0, n, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        const u32 = new Uint32Array(1);
        const f32 = new Float32Array(u32.buffer);
        for (let i = 0; i < n; i++) {
          u32[0] =
            (bytes[i * 4]! | (bytes[i * 4 + 1]! << 8) | (bytes[i * 4 + 2]! << 16) | (bytes[i * 4 + 3]! << 24)) >>> 0;
          data[i * 4 + ch] = f32[0]!;
        }
      }
    }
    const err = gl.getError();
    if (err !== gl.NO_ERROR) error = `GL error 0x${err.toString(16)}`;
  } catch (e) {
    error = (e as Error).message;
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
  return { ok: error === "", log: error, data, mode };
}
