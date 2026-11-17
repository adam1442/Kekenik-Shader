import { useRef, useState } from "react";
import { cx } from "../util/cx";
import { eventToShortcut, shortcutTokens, normalizeShortcut } from "../util/shortcut";
import { useBridge } from "./bridge";
import type { ControlProps } from "./types";

export interface ShortcutRecorderProps extends Omit<ControlProps<string>, "label" | "mixed"> {
  /** Return a message when the recorded shortcut conflicts with another binding (shown, and the shortcut is rejected). */
  conflict?: (shortcut: string) => string | null;
  placeholder?: string;
}

const MODIFIER_ONLY = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock"]);

/** Click, press a key combination, done. Esc cancels, Backspace/Delete clears. Value is a canonical "Mod+Shift+K" string. */
export function ShortcutRecorder({
  value,
  onChange,
  onCommit,
  onCancel,
  conflict,
  placeholder = "Click to record…",
  disabled,
  readOnly,
  invalid,
  message,
  density = "regular",
  className,
  defaultValue,
  tooltip,
  ...rest
}: ShortcutRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const el = useRef<HTMLButtonElement>(null);
  const locked = disabled || readOnly;
  const set = (s: string) => {
    onChange?.(s);
    onCommit?.(s);
  };
  const modified = defaultValue !== undefined && defaultValue !== value;
  const { ref, props } = useBridge({
    kind: "shortcut",
    copyText: () => value,
    copyJson: () => JSON.stringify(value),
    paste: (t) => {
      if (locked || !t.trim()) return false;
      set(normalizeShortcut(t.trim()));
      return true;
    },
    reset: defaultValue !== undefined ? () => set(defaultValue) : undefined,
    canReset: () => modified,
    disabled,
    readOnly,
  });
  const bad = invalid || error !== null;
  return (
    <div
      ref={ref}
      {...props}
      data-kk="shortcut-recorder"
      data-no-pan=""
      className={cx(
        "kk-shortcut",
        `kk-shortcut--${density}`,
        recording && "is-recording",
        bad && "is-invalid",
        locked && "is-disabled",
        modified && "is-modified",
        className,
      )}
      title={bad ? (error ?? message ?? undefined) : tooltip}
    >
      <button
        ref={el}
        type="button"
        className="kk-shortcut__btn"
        disabled={disabled}
        aria-label={rest["aria-label"] ?? "Shortcut"}
        aria-pressed={recording}
        onClick={() => {
          if (!locked) {
            setError(null);
            setRecording(true);
          }
        }}
        onBlur={() => {
          if (recording) {
            setRecording(false);
            onCancel?.();
          }
        }}
        onKeyDown={(e) => {
          if (!recording) return;
          e.preventDefault();
          e.stopPropagation();
          if (MODIFIER_ONLY.has(e.key)) return;
          if (e.key === "Escape") {
            setRecording(false);
            onCancel?.();
            return;
          }
          if ((e.key === "Backspace" || e.key === "Delete") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
            setRecording(false);
            set("");
            return;
          }
          const s = eventToShortcut(e.nativeEvent);
          const c = conflict?.(s) ?? null;
          if (c) {
            setError(c);
            setRecording(false);
            return;
          }
          setError(null);
          setRecording(false);
          set(s);
        }}
      >
        {recording ? (
          <span className="kk-shortcut__hint">Press keys… (Esc cancels)</span>
        ) : value ? (
          shortcutTokens(value).map((t, i) => (
            <kbd key={i} className="kk-kbd">
              {t}
            </kbd>
          ))
        ) : (
          <span className="kk-shortcut__hint">{placeholder}</span>
        )}
      </button>
      {value && !locked && !recording && (
        <button
          type="button"
          className="kk-minibtn kk-minibtn--icon"
          aria-label="Clear shortcut"
          title="Clear"
          onClick={() => {
            setError(null);
            set("");
          }}
        >
          ×
        </button>
      )}
      {bad && (error ?? message) && (
        <span className="kk-text__msg" role="alert">
          {error ?? message}
        </span>
      )}
    </div>
  );
}
