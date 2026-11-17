import { identityMatrix, isIdentityMatrix, parseMatrixText, transposeMatrix } from "@/core/values/vec";
import { formatFixed } from "@/core/values/numeric";
import { cx } from "../util/cx";
import { useBridge } from "./bridge";
import { NumberField } from "./NumberField";
import type { ControlProps } from "./types";

interface MatrixFieldProps extends Omit<ControlProps<number[]>, "mixed"> {
  /** 2, 3 or 4. */
  size?: 2 | 3 | 4;
}

/** mat2/3/4 grid. Data is column-major (like the IR); cells are shown row by row. */
export function MatrixField(props: MatrixFieldProps) {
  const n = props.size ?? (Math.round(Math.sqrt(props.value.length)) as 2 | 3 | 4);
  const {
    value,
    onChange,
    onCommit,
    disabled,
    readOnly,
    density = "compact",
    className,
    defaultValue,
    tooltip,
    label,
  } = props;
  const locked = disabled || readOnly;
  const apply = (v: number[], commit: boolean) => {
    onChange?.(v);
    if (commit) onCommit?.(v);
  };
  const setCell = (r: number, c: number, x: number, commit: boolean) =>
    apply(
      value.map((v, i) => (i === c * n + r ? x : v)),
      commit,
    );
  const reset = defaultValue ?? identityMatrix(n);
  const { ref, props: ctxProps } = useBridge({
    kind: "matrix",
    copyText: () => value.map((x) => formatFixed(x, 4)).join(", "),
    copyJson: () => JSON.stringify(value),
    paste: (t) => {
      const m = parseMatrixText(t, n);
      if (!m || locked) return false;
      apply(m, true);
      return true;
    },
    reset: () => apply(reset, true),
    canReset: () => defaultValue !== undefined && defaultValue.some((d, i) => d !== value[i]),
    disabled,
    readOnly,
    extra: () => [
      { label: "Set identity", run: () => apply(identityMatrix(n), true) },
      { label: "Transpose", run: () => apply(transposeMatrix(value, n), true) },
    ],
  });
  return (
    <div
      ref={ref}
      {...ctxProps}
      data-kk="matrix-field"
      data-no-pan=""
      role="group"
      aria-label={props["aria-label"] ?? (typeof label === "string" ? label : `mat${n}`)}
      title={tooltip}
      className={cx("kk-matrix", locked && "is-disabled", className)}
    >
      <div className="kk-matrix__grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {Array.from({ length: n * n }, (_, k) => {
          const r = Math.floor(k / n);
          const c = k % n;
          return (
            <NumberField
              key={k}
              value={value[c * n + r] ?? 0}
              step={0.01}
              precision={3}
              density={density}
              disabled={disabled}
              readOnly={readOnly}
              aria-label={`m${r}${c}`}
              onChange={(x) => setCell(r, c, x, false)}
              onCommit={(x) => setCell(r, c, x, true)}
            />
          );
        })}
      </div>
      <div className="kk-matrix__bar">
        <button
          type="button"
          className="kk-minibtn"
          disabled={locked || isIdentityMatrix(value, n)}
          onClick={() => apply(identityMatrix(n), true)}
        >
          Identity
        </button>
        <button
          type="button"
          className="kk-minibtn"
          disabled={locked}
          onClick={() => apply(transposeMatrix(value, n), true)}
        >
          Transpose
        </button>
        <button
          type="button"
          className="kk-minibtn"
          disabled={locked || defaultValue === undefined}
          onClick={() => apply(reset, true)}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
