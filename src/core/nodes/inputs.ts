import type { BuiltinInput } from "../ir/inputs";
import type { Space } from "../types/semantics";
import { T } from "../types/generics";
import { defineNode } from "./define";

export const uvNode = defineNode({
  id: "uv",
  category: "Input/Geometry",
  name: "UV",
  synonyms: ["texcoord", "texture coordinates"],
  description: "Mesh UV coordinates (origin bottom-left).",
  params: [
    {
      id: "channel",
      label: "Channel",
      control: "enum",
      default: "0",
      options: [0, 1, 2, 3].map((i) => ({ value: String(i), label: `UV${i}` })),
    },
  ],
  outputs: [{ id: "out", name: "Out", type: T("vec2"), tag: { semantic: "uv" } }],
  build: (c) => ({ out: c.b.input(`uv${c.param<string>("channel")}` as BuiltinInput) }),
});

export const timeNode = defineNode({
  id: "time",
  category: "Input/Basic",
  name: "Time",
  synonyms: ["seconds", "animate"],
  description: "Elapsed time in seconds, plus sine/cosine of it and the frame delta.",
  outputs: [
    { id: "time", name: "Time", type: T("float") },
    { id: "sine", name: "Sine Time", type: T("float") },
    { id: "cosine", name: "Cosine Time", type: T("float") },
    { id: "delta", name: "Delta Time", type: T("float") },
    { id: "smoothDelta", name: "Smooth Delta", type: T("float") },
  ],
  build: (c) => {
    const t = c.b.input("time");
    return {
      time: t,
      sine: c.b.intrinsic("sin", [t]),
      cosine: c.b.intrinsic("cos", [t]),
      delta: c.b.input("deltaTime"),
      smoothDelta: c.b.input("smoothDeltaTime"),
    };
  },
});

export const positionNode = defineNode({
  id: "position",
  category: "Input/Geometry",
  name: "Position",
  synonyms: ["vertex position", "world pos"],
  description: "Vertex/fragment position in the chosen space.",
  params: [
    {
      id: "space",
      label: "Space",
      control: "enum",
      default: "object",
      options: (["object", "world", "view", "clip"] as const).map((s) => ({ value: s, label: s })),
    },
  ],
  dynamicPorts: (node) => {
    const space = String(node.params.space ?? "object") as Space;
    return {
      inputs: [],
      outputs: [
        { id: "out", name: "Out", type: T(space === "clip" ? "vec4" : "vec3"), tag: { semantic: "position", space } },
      ],
    };
  },
  build: (c) => ({ out: c.b.input("position", c.param<string>("space") as Space) }),
});
