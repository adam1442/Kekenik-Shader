/** Removed / renamed identifiers (docs/EXPORT_TARGETS.md A.6). Emitting any key is an error (`godot.removed-identifiers`). */
export const REMOVED_IDENTIFIERS: Readonly<Record<string, string>> = {
  hint_color: "source_color",
  hint_albedo: "source_color",
  hint_white: "hint_default_white",
  hint_black: "hint_default_black",
  hint_black_albedo: "hint_default_black + source_color",
  hint_aniso: "hint_anisotropy",
  SCREEN_TEXTURE: "uniform sampler2D … : hint_screen_texture",
  DEPTH_TEXTURE: "uniform sampler2D … : hint_depth_texture",
  WORLD_MATRIX: "MODEL_MATRIX",
  CAMERA_MATRIX: "INV_VIEW_MATRIX",
  INV_CAMERA_MATRIX: "VIEW_MATRIX",
  ALPHA_SCISSOR: "ALPHA_SCISSOR_THRESHOLD",
  TRANSMISSION: "BACKLIGHT",
};

/** GLSL leftovers that are never valid in a `.gdshader` (`godot.glsl-leftovers`). */
export const GLSL_LEFTOVERS: ReadonlyArray<{ re: RegExp; what: string }> = [
  { re: /#\s*version\b/, what: "#version" },
  { re: /\blayout\s*\(/, what: "layout(" },
  { re: /\bgl_FragColor\b/, what: "gl_FragColor" },
  { re: /\bgl_Position\b/, what: "gl_Position" },
  { re: /\bgl_[A-Z][A-Za-z]+\b/, what: "gl_* built-in" },
  { re: /\btexture2D\s*\(/, what: "texture2D(" },
  { re: /\bprecision\s+(lowp|mediump|highp)\b/, what: "precision" },
  { re: /\bvoid\s+main\s*\(/, what: "void main" },
];

export const PROCESSOR_FUNCTIONS: readonly string[] = [
  "vertex",
  "fragment",
  "light",
  "start",
  "process",
  "collide",
  "sky",
  "fog",
];
