import type { Text } from "./types";

/** Binary operator spelling shared by every language (the IR operator kinds map 1:1 onto C-family operators). */
export const BIN_OPS: Readonly<Record<string, string>> = {
  add: "+",
  sub: "-",
  mul: "*",
  div: "/",
  lt: "<",
  le: "<=",
  gt: ">",
  ge: ">=",
  eq: "==",
  ne: "!=",
  and: "&&",
  or: "||",
};

/** Text constructors: `plain` needs no parentheses as an operand, `op` is an unparenthesised operator expression. */
export const plain = (t: string): Text => ({ t, wrap: false });
export const op = (t: string): Text => ({ t, wrap: true });
/** A literal: a leading minus sign needs parentheses as an operand (`a - (-1.0)`, `-(-x)`). */
export const neg = (t: string): Text => ({ t, wrap: t.startsWith("-") });

/** `(a * b)` → `a * b` when ONE pair of parentheses encloses the whole text (used to avoid `normalize((a * b))`). */
export function stripParens(x: string): string {
  if (!x.startsWith("(") || !x.endsWith(")")) return x;
  let depth = 0;
  for (let i = 0; i < x.length; i++) {
    if (x[i] === "(") depth++;
    else if (x[i] === ")" && --depth === 0 && i < x.length - 1) return x;
  }
  return x.slice(1, -1);
}

/** Map lookup that must succeed (internal invariant: every referenced function / uniform was registered before emission). */
export function must<T>(value: T | undefined, what: string, id: string): T {
  if (value === undefined) throw new Error(`Unknown ${what} "${id}"`);
  return value;
}
