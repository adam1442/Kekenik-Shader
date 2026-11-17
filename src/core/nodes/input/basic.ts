import { T } from "../../types/generics";
import { baseNode } from "../kit";

const CAT = "Input/Basic";

export const intNode = baseNode({
  id: "int",
  category: CAT,
  name: "Integer",
  synonyms: ["int", "whole number"],
  description: "A constant integer.",
  inputs: [{ id: "x", name: "X", type: T("int"), default: 0 }],
  outputs: [{ id: "out", name: "Out", type: T("int") }],
  build: (c) => ({ out: c.in("x") }),
});

export const boolNode = baseNode({
  id: "bool",
  category: CAT,
  name: "Boolean",
  synonyms: ["bool", "true", "false", "toggle"],
  description: "A constant true / false value.",
  inputs: [{ id: "x", name: "X", type: T("bool"), default: false }],
  outputs: [{ id: "out", name: "Out", type: T("bool") }],
  build: (c) => ({ out: c.in("x") }),
});
