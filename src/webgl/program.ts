export interface ProgramResult {
  ok: boolean;
  program: WebGLProgram | null;
  /** Info logs (empty string when clean). */
  vertexLog: string;
  fragmentLog: string;
  linkLog: string;
  /** All logs joined, prefixed with the failing stage. */
  log: string;
}

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  src: string,
): { shader: WebGLShader; ok: boolean; log: string } {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  const ok = !!gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  return { shader, ok, log: gl.getShaderInfoLog(shader) ?? "" };
}

/** Compile + link a vertex/fragment pair with the real driver and report the info logs. */
export function compileProgram(gl: WebGL2RenderingContext, vertexSrc: string, fragmentSrc: string): ProgramResult {
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSrc);
  const parts: string[] = [];
  if (!vs.ok) parts.push(`vertex shader: ${vs.log}`);
  if (!fs.ok) parts.push(`fragment shader: ${fs.log}`);
  let program: WebGLProgram | null = null;
  let linkLog = "";
  if (vs.ok && fs.ok) {
    program = gl.createProgram()!;
    gl.attachShader(program, vs.shader);
    gl.attachShader(program, fs.shader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      linkLog = gl.getProgramInfoLog(program) ?? "link failed";
      parts.push(`link: ${linkLog}`);
      gl.deleteProgram(program);
      program = null;
    }
  }
  gl.deleteShader(vs.shader);
  gl.deleteShader(fs.shader);
  return { ok: program !== null, program, vertexLog: vs.log, fragmentLog: fs.log, linkLog, log: parts.join("\n") };
}
