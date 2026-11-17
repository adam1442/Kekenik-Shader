import { type ReactNode } from "react";
import { type Density, IntField, NumberField, TextField, type TextFieldProps } from "@/ui";
import { useDraft } from "./useDraft";

/** Text edited freely, committed once (Enter / blur). */
export function CommitText(
  p: {
    value: string;
    onCommit: (v: string) => void;
    placeholder?: string;
    mono?: boolean;
    invalid?: boolean;
    message?: string;
    disabled?: boolean;
  } & Pick<TextFieldProps, "aria-label">,
) {
  return (
    <TextField
      value={p.value}
      onChange={() => undefined}
      onCommit={p.onCommit}
      placeholder={p.placeholder}
      mono={p.mono}
      invalid={p.invalid}
      message={p.message}
      disabled={p.disabled}
      aria-label={p["aria-label"]}
    />
  );
}

/** Number edited with a draft, committed once per gesture. */
export function CommitNumber(p: {
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  density?: Density;
  "aria-label": string;
  disabled?: boolean;
}) {
  const d = useDraft<number>(p.value, p.onCommit);
  const common = {
    density: p.density,
    disabled: p.disabled,
    "aria-label": p["aria-label"],
    ...(p.min !== undefined ? { min: p.min } : {}),
    ...(p.max !== undefined ? { max: p.max } : {}),
    ...d,
  };
  return p.integer ? <IntField {...common} /> : <NumberField step={p.step ?? 0.01} {...common} />;
}

/** A labelled block inside the inspector (flat, grid-aligned). */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="kk-bb-field" title={hint}>
      <label>{label}</label>
      <div className="kk-bb-field__ctl">{children}</div>
    </div>
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="kk-insp__sec">
      <h4 className="kk-bb-sec-head">
        <span>{title}</span>
        {actions}
      </h4>
      {children}
    </div>
  );
}
