import { X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { IDENTIFIER_HINT, validateIdentifier, type IdentifierRules } from "@/core/values/identifier";
import { cx } from "../util/cx";
import { useBridge } from "./bridge";
import type { ControlProps } from "./types";

export interface TextFieldProps extends Omit<ControlProps<string>, "label"> {
  placeholder?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  clearable?: boolean;
  mono?: boolean;
  /** Return an error message to mark the draft invalid. Invalid drafts are never committed (blur reverts). */
  validate?: (v: string) => string | null;
  /** Text direction: `auto` (default) follows the content, so RTL text is laid out correctly. */
  dir?: "auto" | "ltr" | "rtl";
  maxLength?: number;
  autoFocus?: boolean;
  selectOnFocus?: boolean;
  /** Borderless variant (inline rename, palettes). */
  bare?: boolean;
  type?: "text" | "search" | "password";
  inputRef?: Ref<HTMLInputElement>;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
  "aria-controls"?: string;
  "aria-activedescendant"?: string;
  role?: string;
}

/** Single-line text input with draft/commit semantics: onChange live, onCommit on Enter/blur (once), Esc cancels. */
export function TextField(props: TextFieldProps) {
  const {
    value,
    onChange,
    onCommit,
    onCancel,
    placeholder,
    prefix,
    suffix,
    clearable,
    mono,
    validate,
    dir = "auto",
    disabled,
    readOnly,
    mixed,
    invalid,
    message,
    density = "regular",
    className,
    tooltip,
    defaultValue,
    bare,
    selectOnFocus,
    autoFocus,
    maxLength,
  } = props;
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const started = useRef(value);
  const skipBlur = useRef(false);
  const el = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  useEffect(() => {
    if (autoFocus) {
      el.current?.focus();
      if (selectOnFocus) el.current?.select();
    }
  }, [autoFocus, selectOnFocus]);

  const error = validate ? validate(draft) : null;
  const bad = invalid || error !== null;
  const locked = disabled || readOnly;

  const commit = () => {
    if (skipBlur.current) return;
    if (error !== null) {
      setDraft(started.current);
      return;
    }
    if (draft !== started.current || (mixed && draft !== "")) {
      started.current = draft;
      onCommit?.(draft);
    }
  };
  const modified = defaultValue !== undefined && defaultValue !== value;
  const { ref, props: ctx } = useBridge({
    kind: "text",
    copyText: () => value,
    copyJson: () => JSON.stringify(value),
    paste: (t) => {
      if (locked || (validate && validate(t) !== null)) return false;
      onChange?.(t);
      onCommit?.(t);
      return true;
    },
    reset:
      defaultValue !== undefined
        ? () => {
            onChange?.(defaultValue);
            onCommit?.(defaultValue);
          }
        : undefined,
    canReset: () => modified,
    disabled,
    readOnly,
  });
  const setRefs = (n: HTMLInputElement | null) => {
    el.current = n;
    const r = props.inputRef;
    if (typeof r === "function") r(n);
    else if (r) (r as { current: HTMLInputElement | null }).current = n;
  };
  return (
    <div
      ref={ref}
      {...ctx}
      data-kk="text-field"
      data-no-pan=""
      data-density={density}
      className={cx(
        "kk-text",
        `kk-text--${density}`,
        bare && "kk-text--bare",
        mono && "kk-text--mono",
        locked && "is-disabled",
        readOnly && "is-readonly",
        bad && "is-invalid",
        mixed && "is-mixed",
        modified && "is-modified",
        className,
      )}
      title={bad ? (error ?? message ?? undefined) : tooltip}
    >
      {prefix !== undefined && <span className="kk-text__affix">{prefix}</span>}
      <input
        ref={setRefs}
        type={props.type ?? "text"}
        className="kk-text__input"
        dir={dir}
        value={mixed && draft === "" ? "" : draft}
        placeholder={mixed ? "\u2014 mixed \u2014" : placeholder}
        disabled={disabled}
        readOnly={readOnly}
        maxLength={maxLength}
        spellCheck={false}
        autoComplete="off"
        role={props.role}
        aria-label={props["aria-label"]}
        aria-invalid={bad || undefined}
        aria-controls={props["aria-controls"]}
        aria-activedescendant={props["aria-activedescendant"]}
        onFocus={(e) => {
          focused.current = true;
          started.current = value;
          if (selectOnFocus) e.currentTarget.select();
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange?.(e.target.value);
        }}
        onBlur={() => {
          focused.current = false;
          commit();
          props.onBlur?.();
        }}
        onKeyDown={(e) => {
          props.onKeyDown?.(e);
          if (e.defaultPrevented) return;
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape" && draft !== started.current) {
            // Only consume Esc when there is an edit to cancel; otherwise let dialogs / popovers handle it.
            e.preventDefault();
            e.stopPropagation();
            skipBlur.current = true;
            setDraft(started.current);
            onChange?.(started.current);
            onCancel?.();
            (e.currentTarget as HTMLInputElement).blur(); // blur handler sees skipBlur and does not commit the stale draft
            skipBlur.current = false;
          }
        }}
      />
      {clearable && draft !== "" && !locked && (
        <button
          type="button"
          className="kk-text__clear"
          aria-label="Clear"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setDraft("");
            onChange?.("");
            onCommit?.("");
            el.current?.focus();
          }}
        >
          <X size={11} />
        </button>
      )}
      {suffix !== undefined && <span className="kk-text__affix">{suffix}</span>}
      {bad && (error ?? message) && density === "regular" && (
        <span className="kk-text__msg" role="alert">
          {error ?? message}
        </span>
      )}
    </div>
  );
}

export interface TextAreaProps extends Omit<
  TextFieldProps,
  "type" | "prefix" | "suffix" | "clearable" | "inputRef" | "onKeyDown"
> {
  rows?: number;
}

/** Multi-line text. Ctrl/Cmd+Enter commits; blur commits; Esc cancels. */
export function TextArea({
  value,
  onChange,
  onCommit,
  onCancel,
  rows = 4,
  placeholder,
  dir = "auto",
  disabled,
  readOnly,
  mixed,
  invalid,
  message,
  validate,
  density = "regular",
  className,
  mono,
  tooltip,
  defaultValue,
  ...rest
}: TextAreaProps) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const started = useRef(value);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  const error = validate ? validate(draft) : null;
  const bad = invalid || error !== null;
  const commit = () => {
    if (error !== null) return setDraft(started.current);
    if (draft !== started.current) {
      started.current = draft;
      onCommit?.(draft);
    }
  };
  const modified = defaultValue !== undefined && defaultValue !== value;
  const { ref, props: ctx } = useBridge({
    kind: "text",
    copyText: () => value,
    copyJson: () => JSON.stringify(value),
    reset:
      defaultValue !== undefined
        ? () => {
            onChange?.(defaultValue);
            onCommit?.(defaultValue);
          }
        : undefined,
    canReset: () => modified,
    disabled,
    readOnly,
  });
  return (
    <div
      ref={ref}
      {...ctx}
      data-kk="text-area"
      data-no-pan=""
      className={cx(
        "kk-text kk-text--area",
        `kk-text--${density}`,
        mono && "kk-text--mono",
        disabled && "is-disabled",
        readOnly && "is-readonly",
        bad && "is-invalid",
        mixed && "is-mixed",
        className,
      )}
      title={bad ? (error ?? message ?? undefined) : tooltip}
    >
      <textarea
        className="kk-text__input"
        rows={rows}
        dir={dir}
        value={draft}
        placeholder={mixed ? "\u2014 mixed \u2014" : placeholder}
        disabled={disabled}
        readOnly={readOnly}
        spellCheck={false}
        aria-label={rest["aria-label"]}
        aria-invalid={bad || undefined}
        onFocus={() => {
          focused.current = true;
          started.current = value;
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange?.(e.target.value);
        }}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setDraft(started.current);
            onChange?.(started.current);
            onCancel?.();
            (e.currentTarget as HTMLTextAreaElement).blur();
          }
        }}
      />
      {bad && (error ?? message) && (
        <span className="kk-text__msg" role="alert">
          {error ?? message}
        </span>
      )}
    </div>
  );
}

interface IdentifierFieldProps extends Omit<TextFieldProps, "validate" | "mono"> {
  rules?: IdentifierRules;
}

/** Reference-name field: live validation (charset, digits, reserved words, collisions) with the rules as tooltip. */
export function IdentifierField({ rules, tooltip, ...rest }: IdentifierFieldProps) {
  return (
    <TextField
      {...rest}
      mono
      tooltip={tooltip ?? IDENTIFIER_HINT}
      dir="ltr"
      validate={(v) => validateIdentifier(v, rules)}
    />
  );
}

export interface InlineEditableLabelProps {
  value: string;
  onCommit: (v: string) => void;
  onChange?: (v: string) => void;
  onCancel?: () => void;
  validate?: (v: string) => string | null;
  disabled?: boolean;
  className?: string;
  /** Start in edit mode. */
  editing?: boolean;
  "aria-label"?: string;
}

/** Text that turns into an input on double-click (rename). Enter / blur commit, Esc cancels. */
export function InlineEditableLabel({
  value,
  onCommit,
  onChange,
  onCancel,
  validate,
  disabled,
  className,
  editing: initial,
  ...rest
}: InlineEditableLabelProps) {
  const [editing, setEditing] = useState(!!initial);
  if (editing) {
    return (
      <TextField
        bare
        autoFocus
        selectOnFocus
        value={value}
        className={cx("kk-inlinelabel is-editing", className)}
        validate={validate}
        aria-label={rest["aria-label"] ?? "Rename"}
        onChange={onChange}
        onCommit={(v) => {
          setEditing(false);
          onCommit(v);
        }}
        onCancel={() => {
          setEditing(false);
          onCancel?.();
        }}
        onBlur={() => setEditing(false)}
      />
    );
  }
  return (
    <span
      data-kk="inline-label"
      data-no-pan=""
      className={cx("kk-inlinelabel", disabled && "is-disabled", className)}
      tabIndex={disabled ? -1 : 0}
      title="Double-click to rename"
      dir="auto"
      onDoubleClick={() => !disabled && setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "F2" && !disabled) {
          e.preventDefault();
          setEditing(true);
        }
      }}
    >
      {value}
    </span>
  );
}
