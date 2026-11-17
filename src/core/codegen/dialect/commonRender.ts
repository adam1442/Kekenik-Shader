import type { IRExpr } from "../../ir/types";
import { BIN_OPS, op, plain } from "./ops";
import type { RenderApi, Text } from "./types";

/** IR operations every text language spells identically (leaves, C-style unary / binary operators, swizzles). */
export type CommonExpr = Extract<
  IRExpr,
  { op: "param" | "input" | "uniform" | "samplerState" | "unary" | "binary" | "swizzle" }
>;

/** Dialects delegate these cases (`case "param": … return renderCommon(e, api)`) so the switch stays exhaustive per language. */
export function renderCommon(e: CommonExpr, api: RenderApi): Text {
  const svc = api.svc;
  switch (e.op) {
    case "param":
      return plain(api.param(e.index));
    case "input":
      return plain(svc.inputText(e));
    case "uniform":
      return plain(svc.uniformText(e.prop));
    case "samplerState":
      return plain(svc.samplerStateText(e));
    case "unary":
      return op(`${e.kind === "neg" ? "-" : "!"}${api.use(e.a)}`);
    case "binary":
      return op(`${api.use(e.a)} ${BIN_OPS[e.kind]} ${api.use(e.b)}`);
    case "swizzle":
      return plain(`${api.use(e.src)}.${e.mask}`);
  }
}
