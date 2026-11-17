import type { BuildContext, ParamSchema } from "../../registry/nodeDef";
import { enumParam } from "../kit";
import { M } from "./irm";

/**
 * Hash mode of the procedural nodes .
 *  - `integer`: portable PCG integer hash (`ihash` intrinsic) — bit-identical on every GPU / target;
 * - `legacy`: the float "hash without sine" family — kept so graphs saved before render exactly as before.
 * The schema default is `legacy` (what a stored node WITHOUT the parameter means); freshly created nodes get `newDefault` = `integer`.
 */
export const HASH_PARAM: ParamSchema = {
  ...enumParam(
    "hash",
    "Hash",
    [
      ["integer", "Integer (portable)"],
      ["legacy", "Legacy (float)"],
    ],
    "legacy",
  ),
  newDefault: "integer",
  tooltip:
    "Integer: PCG hash on 32-bit unsigned integers — the same pattern on every GPU and engine. Legacy: float-only hash (pattern may differ slightly between GPUs); files saved before this option existed keep it.",
};

/** IR sugar for a node build that honours its `hash` parameter. */
export function hashM(c: BuildContext): M {
  const m = new M(c.b);
  m.intHash = c.param("hash") === "integer";
  return m;
}
