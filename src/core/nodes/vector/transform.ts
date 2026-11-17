import { T } from "../../types/generics";
import type { Space } from "../../types/semantics";
import type { ExprId } from "../../ir/types";
import { baseNode, enumParam } from "../kit";

const ORDER: Space[] = ["object", "world", "view", "clip"];
const SPACE_OPTS = (list: Space[]): Array<[string, string]> => list.map((s) => [s, s[0]!.toUpperCase() + s.slice(1)]);

/** Single-step engine matrices between adjacent spaces (see codegen/dialect/engine). */
const STEP: Record<string, string> = {
  "object>world": "ks.matrix.objectToWorld",
  "world>view": "ks.matrix.worldToView",
  "view>clip": "ks.matrix.viewToClip",
  "world>object": "ks.matrix.worldToObject",
  "view>world": "ks.matrix.viewToWorld",
};

const toClip = (target: unknown): boolean => target === "clip";

export const transformNode = baseNode({
  id: "transform",
  category: "Matrix",
  name: "Transform",
  synonyms: ["space", "object to world", "world to object", "view space", "clip space", "convert space"],
  description:
    "Converts a position, direction or normal between object, world, view and clip space. Clip space is output-only and for positions only (the result is a Vector 4).",
  params: [
    enumParam(
      "kind",
      "Type",
      [
        ["position", "Position"],
        ["direction", "Direction"],
        ["normal", "Normal"],
      ],
      "position",
    ),
    enumParam("source", "From", SPACE_OPTS(["object", "world", "view"]), "object"),
    enumParam("target", "To", SPACE_OPTS(ORDER), "world"),
    { id: "normalize", label: "Normalize", control: "bool", default: false },
  ],
  dynamicPorts: (node) => ({
    inputs: [{ id: "in", name: "In", type: T("vec3"), default: 0 }],
    outputs: [{ id: "out", name: "Out", type: T(toClip(node.params.target) ? "vec4" : "vec3") }],
  }),
  validate: (node) => {
    const kind = String(node.params.kind ?? "position");
    return toClip(node.params.target) && kind !== "position"
      ? [{ code: "E_INVALID_VALUE" as const, message: "Only positions can be transformed to clip space" }]
      : [];
  },
  build: (c) => {
    const kind = c.param<string>("kind");
    const from = ORDER.indexOf(c.param<string>("source") as Space);
    const to = ORDER.indexOf(c.param<string>("target") as Space);
    if (from < 0 || to < 0 || from === 3) c.fail("Invalid space selection");
    if (to === 3 && kind !== "position") c.fail("Only positions can be transformed to clip space");
    const input = c.in("in");
    let v: ExprId = c.b.construct("vec4", [input, c.b.float(kind === "position" ? 1 : 0)]);
    let cur = from;
    while (cur !== to) {
      const next = cur < to ? cur + 1 : cur - 1;
      const key = `${ORDER[cur]}>${ORDER[next]}`;
      const engine = STEP[key];
      if (!engine) c.fail(`No matrix for ${key}`);
      // Normals use the inverse-transpose between object and world; every other step is a rotation-compatible matrix.
      if (kind === "normal" && (key === "object>world" || key === "world>object")) {
        const m3 = c.b.engine(
          key === "object>world" ? "ks.matrix.normalObjectToWorld" : "ks.matrix.normalWorldToObject",
          "mat3",
        );
        v = c.b.construct("vec4", [c.b.matmul(m3, c.b.swizzle(v, "xyz")), c.b.float(0)]);
      } else v = c.b.matmul(c.b.engine(engine!, "mat4"), v);
      cur = next;
    }
    if (to === 3) return { out: v };
    let out: ExprId = c.b.swizzle(v, "xyz");
    if (c.param<boolean>("normalize") || kind === "normal") out = c.b.intrinsic("normalize", [out]);
    return { out };
  },
});
