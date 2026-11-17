import { StreamLanguage, type StringStream } from "@codemirror/language";

/** Small token-level modes for WGSL and HLSL (the bundled clike `shader` mode only knows GLSL). */
interface Words {
  keywords: Set<string>;
  types: Set<string>;
  builtins: Set<string>;
}
const set = (s: string): Set<string> => new Set(s.split(/\s+/).filter(Boolean));

const WGSL: Words = {
  keywords: set(
    "fn let var const struct return if else for while loop break continue discard switch case default override alias true false private uniform storage workgroup function read write read_write",
  ),
  types: set(
    "f32 i32 u32 f16 bool vec2 vec3 vec4 mat2x2 mat3x3 mat4x4 mat2x3 mat3x2 mat2x4 mat4x2 mat3x4 mat4x3 array ptr sampler texture_2d texture_depth_2d atomic",
  ),
  builtins: set(
    "abs acos asin atan atan2 ceil clamp cos cross degrees distance dot dpdx dpdy exp exp2 floor fract fwidth inverseSqrt length log log2 max min mix normalize pow radians reflect refract round saturate select sign sin smoothstep sqrt step tan transpose trunc textureSample textureSampleLevel textureSampleGrad textureLoad",
  ),
};
const HLSL: Words = {
  keywords: set(
    "struct cbuffer static const return if else for while do break continue discard switch case default in out inout uniform register true false typedef",
  ),
  types: set(
    "float float2 float3 float4 int int2 int3 int4 uint uint2 uint3 uint4 bool half half2 half3 half4 void float2x2 float3x3 float4x4 matrix vector Texture2D SamplerState",
  ),
  builtins: set(
    "abs acos asin atan atan2 ceil clamp cos cross ddx ddy degrees distance dot exp exp2 floor fmod frac fwidth length lerp log log2 max min mul normalize pow radians reflect refract round rsqrt saturate sign sin smoothstep sqrt step tan transpose trunc asfloat Sample SampleLevel SampleGrad",
  ),
};

function makeMode(w: Words, attr: RegExp) {
  return {
    token(stream: StringStream): string | null {
      if (stream.eatSpace()) return null;
      if (stream.match("//")) {
        stream.skipToEnd();
        return "comment";
      }
      if (stream.match(/^\/\*.*?\*\//)) return "comment";
      if (stream.match(/^0[xX][0-9a-fA-F]+[uU]?/) || stream.match(/^(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?[fFiu]?/))
        return "number";
      if (attr.test("") === false && stream.match(attr)) return "meta";
      if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
        const t = stream.current();
        if (w.keywords.has(t)) return "keyword";
        if (w.types.has(t)) return "typeName";
        if (w.builtins.has(t)) return "variableName.standard";
        if (/^ks_/.test(t)) return "def";
        return "variableName";
      }
      stream.next();
      return "operator";
    },
  };
}

export const wgslLanguage = StreamLanguage.define(makeMode(WGSL, /^@[A-Za-z_]+/));
export const hlslLanguage = StreamLanguage.define(makeMode(HLSL, /^#[A-Za-z_]+/));
