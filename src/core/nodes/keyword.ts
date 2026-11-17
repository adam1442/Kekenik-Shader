import type { NodeInstance } from "../graph/types";
import type { BuildContext, PortContext, PortDef } from "../registry/nodeDef";
import { numeric, sameAs } from "../types/generics";
import { defineNode } from "./define";

export const KEYWORD_PARAM = "keyword";

const keywordOf = (node: NodeInstance, ctx: PortContext) =>
  ctx.graph.keywords.find((k) => k.id === node.params[KEYWORD_PARAM]);

const missing = (node: NodeInstance, ctx: PortContext, kind: "boolean" | "enum") => {
  const k = keywordOf(node, ctx);
  if (!k)
    return [
      {
        code: "E_UNKNOWN_KEYWORD" as const,
        message: `Keyword "${String(node.params[KEYWORD_PARAM] ?? "")}" does not exist`,
      },
    ];
  return k.kind === kind
    ? []
    : [{ code: "E_UNKNOWN_KEYWORD" as const, message: `Keyword "${k.displayName}" is not a ${kind} keyword` }];
};

const graphEntries = (c: BuildContext, id: string): number =>
  c.graph.keywords.find((k) => k.id === id)?.entries?.length ?? 1;

const inPort = (id: string, name: string): PortDef => ({ id, name, type: numeric("K"), default: 0 });

/** Static switch on a Boolean keyword: the "On" or the "Off" branch is compiled, never both. */
export const keywordBoolNode = defineNode({
  id: "keywordBool",
  category: "Input/Keyword",
  name: "Boolean Keyword",
  synonyms: ["static switch", "shader feature", "toggle", "variant", "multi compile"],
  description:
    "Compile-time switch on a Boolean keyword from the Blackboard. Only the active branch is generated for a shader variant.",
  params: [{ id: KEYWORD_PARAM, label: "Keyword", control: "string", default: "" }],
  inputs: [inPort("on", "On"), inPort("off", "Off")],
  outputs: [{ id: "out", name: "Out", type: sameAs("on") }],
  validate: (node, ctx) => missing(node, ctx, "boolean"),
  build: (c) => {
    const id = String(c.param(KEYWORD_PARAM));
    const sel = c.keywordSelector(id);
    if (sel !== undefined) return { out: c.b.select(c.b.binary("ne", sel, c.b.int(0)), c.in("on"), c.in("off")) };
    return { out: c.in(c.keyword(id) !== 0 ? "on" : "off") };
  },
});

/** Static switch on an Enum keyword: one input per entry, only the selected one is compiled. */
export const keywordEnumNode = defineNode({
  id: "keywordEnum",
  category: "Input/Keyword",
  name: "Enum Keyword",
  synonyms: ["static switch", "enum switch", "shader feature", "variant", "multi compile"],
  description:
    "Compile-time switch on an Enum keyword from the Blackboard. One input per entry; only the selected one is generated for a variant.",
  params: [{ id: KEYWORD_PARAM, label: "Keyword", control: "string", default: "" }],
  dynamicPorts: (node, ctx) => {
    const k = keywordOf(node, ctx);
    const entries = k?.kind === "enum" && k.entries?.length ? k.entries : ["Entry 1", "Entry 2"];
    return {
      inputs: entries.map((name, i) => inPort(`e${i}`, name)),
      outputs: [{ id: "out", name: "Out", type: sameAs("e0") }],
    };
  },
  validate: (node, ctx) => missing(node, ctx, "enum"),
  build: (c) => {
    const id = String(c.param(KEYWORD_PARAM));
    const sel = c.keywordSelector(id);
    if (sel !== undefined) {
      // Runtime variant: nested selects over the keyword index (the shader compiler folds them per variant).
      const count = Math.max(1, graphEntries(c, id));
      let r = c.in(`e${count - 1}`);
      for (let i = count - 2; i >= 0; i--) r = c.b.select(c.b.binary("eq", sel, c.b.int(i)), c.in(`e${i}`), r);
      return { out: r };
    }
    return { out: c.in(`e${c.keyword(id)}`) };
  },
});
