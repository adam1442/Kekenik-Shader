import { T } from "../../types/generics";
import { floatVecOfSize } from "../../types/shaderType";
import type { ShaderType } from "../../types/shaderType";
import { componentCount } from "../../types/shaderType";
import { baseNode, enumParam } from "../kit";

const CAT = "Channel";
const MASK_CHARS = /^[xyzwrgba]+$/;

const vecType = (n: number): ShaderType => (n === 1 ? "float" : n === 2 ? "vec2" : n === 3 ? "vec3" : "vec4");

export const swizzleNode = baseNode({
  id: "swizzle",
  category: CAT,
  name: "Swizzle",
  synonyms: ["mask", "channel", "reorder", "xyzw", "rgba"],
  description:
    'Reorders / repeats components with a mask such as "zyx", "rg" or "xxxx" (1–4 letters from xyzw / rgba). The input is widened to a Vector 4 first (a float is splatted, missing components are 0).',
  params: [{ id: "mask", label: "Mask", control: "string", default: "xy" }],
  inputs: [{ id: "in", name: "In", type: T("vec4"), default: 0 }],
  dynamicPorts: (node) => {
    const m = String(node.params.mask ?? "xy");
    const n = MASK_CHARS.test(m) ? Math.min(4, m.length) : 1;
    return {
      inputs: [{ id: "in", name: "In", type: T("vec4"), default: 0 }],
      outputs: [{ id: "out", name: "Out", type: T(vecType(n)) }],
    };
  },
  validate: (node) => {
    const m = String(node.params.mask ?? "xy");
    return MASK_CHARS.test(m) && m.length <= 4
      ? []
      : [{ code: "E_INVALID_VALUE", message: `Swizzle mask "${m}" must be 1–4 letters from xyzw / rgba` }];
  },
  build: (c) => {
    const mask = c.param<string>("mask");
    if (!MASK_CHARS.test(mask) || mask.length > 4)
      c.fail(`Swizzle mask "${mask}" must be 1–4 letters from xyzw / rgba`);
    return { out: c.b.swizzle(c.in("in"), mask) };
  },
});

const sizeOpts = (max: number): Array<[string, string]> =>
  [1, 2, 3, 4].filter((n) => n <= max).map((n) => [String(n), n === 1 ? "Float" : `Vector ${n}`]);

export const appendNode = baseNode({
  id: "append",
  category: CAT,
  name: "Append",
  synonyms: ["concatenate", "join", "extend", "make vector"],
  description: "Appends B's components after A's (A + B components ≤ 4).",
  params: [enumParam("aSize", "A size", sizeOpts(3), "2"), enumParam("bSize", "B size", sizeOpts(3), "1")],
  dynamicPorts: (node) => {
    const a = Math.min(3, Math.max(1, Number(node.params.aSize ?? 2)));
    const b = Math.min(4 - a, Math.max(1, Number(node.params.bSize ?? 1)));
    return {
      inputs: [
        { id: "a", name: "A", type: T(vecType(a)), default: 0 },
        { id: "b", name: "B", type: T(vecType(b)), default: 0 },
      ],
      outputs: [{ id: "out", name: "Out", type: T(vecType(a + b)) }],
    };
  },
  validate: (node) => {
    const a = Number(node.params.aSize ?? 2);
    const b = Number(node.params.bSize ?? 1);
    return a + b <= 4
      ? []
      : [
          {
            code: "W_LOSSY_CONVERSION",
            message: `Append would create ${a + b} components (max 4); B was reduced to ${4 - a}`,
          },
        ];
  },
  build: (c) => ({ out: c.b.construct(floatVecOfSize(componentCount(c.outType("out"))), [c.in("a"), c.in("b")]) }),
});
