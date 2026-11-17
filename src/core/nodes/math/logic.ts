import { T, numeric } from "../../types/generics";
import type { PortDef } from "../../registry/nodeDef";
import { baseNode, enumParam } from "../kit";

const CAT = "Logic";

export const comparisonNode = baseNode({
  id: "comparison",
  category: CAT,
  name: "Comparison",
  synonyms: ["compare", "greater", "less", "equal", "<", ">", "==", "!="],
  description: "Compares two scalars and outputs a boolean.",
  params: [
    enumParam(
      "op",
      "Operation",
      [
        ["lt", "Less"],
        ["le", "Less or Equal"],
        ["gt", "Greater"],
        ["ge", "Greater or Equal"],
        ["eq", "Equal"],
        ["ne", "Not Equal"],
      ],
      "gt",
    ),
  ],
  inputs: [
    { id: "a", name: "A", type: T("float"), default: 0 },
    { id: "b", name: "B", type: T("float"), default: 0 },
  ],
  outputs: [{ id: "out", name: "Out", type: T("bool") }],
  build: (c) => {
    const op = c.param<string>("op");
    if (!["lt", "le", "gt", "ge", "eq", "ne"].includes(op)) c.fail(`Unknown comparison "${op}"`);
    return { out: c.b.binary(op as "lt", c.in("a"), c.in("b")) };
  },
});

const boolIn = (id: string, name: string): PortDef => ({ id, name, type: T("bool"), default: false });

export const logicNode = baseNode({
  id: "logic",
  category: CAT,
  name: "Logic",
  synonyms: ["and", "or", "not", "boolean", "&&", "||", "!"],
  description: "Boolean AND / OR / NOT.",
  params: [
    enumParam(
      "op",
      "Operation",
      [
        ["and", "And"],
        ["or", "Or"],
        ["not", "Not"],
      ],
      "and",
    ),
  ],
  dynamicPorts: (node) => ({
    inputs: String(node.params.op ?? "and") === "not" ? [boolIn("a", "In")] : [boolIn("a", "A"), boolIn("b", "B")],
    outputs: [{ id: "out", name: "Out", type: T("bool") }],
  }),
  build: (c) => {
    const op = c.param<string>("op");
    return {
      out: op === "not" ? c.b.unary("not", c.in("a")) : c.b.binary(op === "or" ? "or" : "and", c.in("a"), c.in("b")),
    };
  },
});

export const branchNode = baseNode({
  id: "branch",
  category: CAT,
  name: "Branch",
  synonyms: ["select", "if", "ternary", "switch", "choose"],
  description: "Outputs True when Predicate is true, otherwise False (both sides are evaluated; no real branching).",
  inputs: [
    boolIn("predicate", "Predicate"),
    { id: "true", name: "True", type: numeric("T"), default: 1 },
    { id: "false", name: "False", type: numeric("T"), default: 0 },
  ],
  outputs: [{ id: "out", name: "Out", type: { k: "sameAs", port: "true" } }],
  build: (c) => ({ out: c.b.select(c.in("predicate"), c.in("true"), c.in("false")) }),
});
