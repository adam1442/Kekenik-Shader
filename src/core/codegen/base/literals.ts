import { type StorageType, componentCount } from "../../types/shaderType";

/**
 * Float literal that always parses as a float in C-like languages (`1` → `1.0`, `1e-7` → `1.0e-7`).
 * Non-finite values have no literal form: they are spelled as arithmetic that overflows/underflows identically
 * on every GPU (`1.0e38*1.0e38` style would be flushed by some compilers, so a division by zero is used).
 */
export function formatFloat(v: number): string {
  if (Number.isNaN(v)) return "(0.0 / 0.0)";
  if (v === Infinity) return "(1.0 / 0.0)";
  if (v === -Infinity) return "(-1.0 / 0.0)";
  if (Object.is(v, -0)) return "0.0";
  // Float32 round-trip: print the shortest decimal that identifies the float32 value (keeps output short and stable).
  let s = String(v);
  const f32 = Math.fround(v);
  if (f32 !== v) {
    for (let digits = 1; digits <= 9; digits++) {
      const t = Number(v.toPrecision(digits));
      if (Math.fround(t) === f32) {
        s = String(t);
        break;
      }
    }
  }
  const abs = Math.abs(v);
  if (abs >= 1e9 || (abs < 1e-5 && abs > 0)) s = Number(s).toExponential(); // keep huge / tiny literals short and exponent-form
  if (/e/i.test(s)) {
    const [mant, exp] = s.toLowerCase().split("e") as [string, string];
    const m = mant.includes(".") ? mant : `${mant}.0`;
    return `${m}e${exp.replace("+", "")}`;
  }
  return s.includes(".") ? s : `${s}.0`;
}

export const formatInt = (v: number): string => String(Math.trunc(Object.is(v, -0) ? 0 : v));

const formatBool = (v: number): string => (v ? "true" : "false");

/** Component literal for a scalar storage type. */
function formatScalar(ty: StorageType, v: number): string {
  return ty === "int" ? formatInt(v) : ty === "bool" ? formatBool(v) : formatFloat(v);
}

/**
 * Constant literal in GLSL-like constructor syntax: `vec3(1.0, 0.5, 0.0)`; equal components collapse to the splat form
 * (`vec3(1.0)`); matrices list their columns (column-major).
 */
export function formatConst(
  ty: StorageType,
  value: readonly number[],
  names: { vec: (n: number) => string; mat: (n: number) => string },
): string {
  if (componentCount(ty) === 1) return formatScalar(ty, value[0]!);
  const ctor =
    ty === "vec2"
      ? names.vec(2)
      : ty === "vec3"
        ? names.vec(3)
        : ty === "vec4"
          ? names.vec(4)
          : ty === "mat2"
            ? names.mat(2)
            : ty === "mat3"
              ? names.mat(3)
              : names.mat(4);
  const isMat = ty.startsWith("mat");
  if (!isMat && value.every((x) => x === value[0])) return `${ctor}(${formatFloat(value[0]!)})`;
  return `${ctor}(${value.map(formatFloat).join(", ")})`;
}
