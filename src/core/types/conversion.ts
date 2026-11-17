import { SHADER_TYPES, type ShaderType, isVectorLike } from "./shaderType";

/**
 * Implicit-conversion table (data-driven).
 *
 * Rows = FROM, columns = TO, both in SHADER_TYPES order. Codes:
 *   `=` exact (identical type)            `S` splat scalar to every component
 *   `T` truncate (drops components, lossy) `P` pad with a default value (lossless)
 *   `R` reinterpret, lossless (cast / same storage)   `L` reinterpret, lossy (cast that may lose info)
 *   `X` forbidden
 */
type ConversionKind = "exact" | "splat" | "truncate" | "pad" | "reinterpret" | "forbidden";

export interface Conversion {
  kind: ConversionKind;
  lossy: boolean;
  warning?: string;
  /** For `pad`: the value written to the last padded component (alpha → 1 when padding into color4, else 0). */
  padValue?: number;
}

const COLUMNS = SHADER_TYPES;
//                flt int bol v2 v3 v4 col c4 m2 m3 m4 tex tA  t3  tC  smp
const ROWS: Record<ShaderType, string> = {
  float: "    =  L  L  S  S  S  S  S  X  X  X  X  X  X  X  X",
  int: "      R  =  L  S  S  S  S  S  X  X  X  X  X  X  X  X",
  bool: "     R  R  =  S  S  S  S  S  X  X  X  X  X  X  X  X",
  vec2: "     T  X  X  =  P  P  P  P  X  X  X  X  X  X  X  X",
  vec3: "     T  X  X  T  =  P  R  P  X  X  X  X  X  X  X  X",
  vec4: "     T  X  X  T  T  =  T  R  X  X  X  X  X  X  X  X",
  color: "    T  X  X  T  R  P  =  P  X  X  X  X  X  X  X  X",
  color4: "   T  X  X  T  T  R  T  =  X  X  X  X  X  X  X  X",
  mat2: "     X  X  X  X  X  X  X  X  =  X  X  X  X  X  X  X",
  mat3: "     X  X  X  X  X  X  X  X  X  =  X  X  X  X  X  X",
  mat4: "     X  X  X  X  X  X  X  X  X  X  =  X  X  X  X  X",
  texture2D: "X  X  X  X  X  X  X  X  X  X  X  =  X  X  X  X",
  texture2DArray: "X  X  X  X  X  X  X  X  X  X  X  X  =  X  X  X",
  texture3D: "X  X  X  X  X  X  X  X  X  X  X  X  X  =  X  X",
  textureCube: "X  X  X  X  X  X  X  X  X  X  X  X  X  X  =  X",
  sampler: "  X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  =",
};

function describe(code: string, from: ShaderType, to: ShaderType): Conversion {
  switch (code) {
    case "=":
      return { kind: "exact", lossy: false };
    case "S":
      return { kind: "splat", lossy: false };
    case "P":
      return { kind: "pad", lossy: false, padValue: to === "color4" ? 1 : 0 };
    case "R":
      return { kind: "reinterpret", lossy: false };
    case "L":
      return {
        kind: "reinterpret",
        lossy: true,
        warning: `Converting ${from} to ${to} may lose information (${to === "bool" ? "any non-zero value becomes true" : "fraction is discarded"})`,
      };
    case "T":
      return {
        kind: "truncate",
        lossy: true,
        warning: isVectorLike(to)
          ? `Truncating ${from} to ${to} drops the extra components`
          : `Converting ${from} to ${to} keeps only the first component`,
      };
    case "X":
      return { kind: "forbidden", lossy: false };
    default:
      throw new Error(`Bad conversion code "${code}" for ${from}→${to}`);
  }
}

function buildTable(): Record<ShaderType, Record<ShaderType, Conversion>> {
  const table = {} as Record<ShaderType, Record<ShaderType, Conversion>>;
  for (const from of COLUMNS) {
    const codes = ROWS[from].trim().split(/\s+/);
    if (codes.length !== COLUMNS.length)
      throw new Error(`Conversion row "${from}" has ${codes.length} cells, expected ${COLUMNS.length}`);
    const row = {} as Record<ShaderType, Conversion>;
    COLUMNS.forEach((to, i) => {
      row[to] = Object.freeze(describe(codes[i]!, from, to));
    });
    table[from] = row;
  }
  return table;
}

const CONVERSION_TABLE: Readonly<Record<ShaderType, Readonly<Record<ShaderType, Conversion>>>> = buildTable();

/** How (and whether) a value of type `from` can feed a port of type `to`. */
export function getConversion(from: ShaderType, to: ShaderType): Conversion {
  return CONVERSION_TABLE[from][to];
}

/**
 * True when a wire from→to needs an implicit conversion (UI colors those wires with a gradient).
 * `exact` → false (same type). `forbidden` → false too: it is not "implicit", it is an error.
 */
export function isImplicit(from: ShaderType, to: ShaderType): boolean {
  const k = getConversion(from, to).kind;
  return k !== "exact" && k !== "forbidden";
}

export const canConvert = (from: ShaderType, to: ShaderType): boolean => getConversion(from, to).kind !== "forbidden";
