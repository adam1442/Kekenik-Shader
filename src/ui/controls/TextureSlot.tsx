import { ImageOff, Search, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import { cx } from "../util/cx";
import { useBridge } from "./bridge";
import { Popover } from "./Popover";
import { Select } from "./Select";
import { TextField } from "./TextField";
import { Vec2Field } from "./VecField";
import type { ControlProps } from "./types";

export type TextureDefaultKind = "white" | "black" | "gray" | "bump" | "red";
export interface TextureValue {
  /** Asset id, or null → the default kind is used. */
  asset: string | null;
  defaultKind: TextureDefaultKind;
  tiling: [number, number];
  offset: [number, number];
}
export const DEFAULT_TEXTURE: TextureValue = { asset: null, defaultKind: "white", tiling: [1, 1], offset: [0, 0] };

export interface AssetInfo {
  id: string;
  name: string;
  /** Image URL / data URI. */
  thumb?: string;
  /** Free-form tag shown as a subtitle ("2048×2048", "HDR"…). */
  info?: string;
}

/** The real provider is `assetProvider` in `preview/assets/assetStore` (project assets / imports). */
export interface AssetProvider {
  list(query?: string): AssetInfo[];
  get(id: string): AssetInfo | undefined;
  subscribe?(listener: () => void): () => void;
}

const EMPTY_PROVIDER: AssetProvider = {
  list: () => [],
  get: () => undefined,
};

const NOOP_SUBSCRIBE = () => () => undefined;
const KIND_COLORS: Record<TextureDefaultKind, string> = {
  white: "#fff",
  black: "#000",
  gray: "#808080",
  bump: "#8080ff",
  red: "#f00",
};
const KINDS = (Object.keys(KIND_COLORS) as TextureDefaultKind[]).map((k) => ({
  value: k,
  label: k === "bump" ? "Bump (normal flat)" : k[0]!.toUpperCase() + k.slice(1),
}));

export interface TextureSlotProps extends Omit<ControlProps<TextureValue>, "label"> {
  provider?: AssetProvider;
  /** Show tiling / offset sub-fields. */
  showTransform?: boolean;
  /** Called when files are dropped on the slot (the Preview imports them as assets). */
  onDropFiles?: (files: File[]) => void;
}

/** Texture slot: thumbnail, drag-drop target, clear, asset picker popover, default-kind dropdown, tiling/offset. */
export function TextureSlot(props: TextureSlotProps) {
  const {
    value,
    onChange,
    onCommit,
    provider = EMPTY_PROVIDER,
    showTransform,
    disabled,
    readOnly,
    mixed,
    invalid,
    message,
    density = "regular",
    className,
    defaultValue,
    tooltip,
    onDropFiles,
  } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [over, setOver] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const locked = disabled || readOnly;
  useSyncExternalStore(provider.subscribe ?? NOOP_SUBSCRIBE, () => provider.list().length);
  const asset = value.asset ? provider.get(value.asset) : undefined;
  const set = (patch: Partial<TextureValue>) => {
    const next = { ...value, ...patch };
    onChange?.(next);
    onCommit?.(next);
  };
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  const modified = defaultValue !== undefined && JSON.stringify(defaultValue) !== JSON.stringify(value);
  const { ref, props: ctx } = useBridge({
    kind: "texture",
    copyText: () => value.asset ?? `default:${value.defaultKind}`,
    copyJson: () => JSON.stringify(value),
    paste: (t) => {
      if (locked) return false;
      const s = t.trim();
      if (s.startsWith("default:") && s.slice(8) in KIND_COLORS) {
        set({ asset: null, defaultKind: s.slice(8) as TextureDefaultKind });
        return true;
      }
      if (provider.get(s)) {
        set({ asset: s });
        return true;
      }
      return false;
    },
    reset: defaultValue ? () => set(defaultValue) : undefined,
    canReset: () => modified,
    disabled,
    readOnly,
    extra: () => [{ label: "Clear texture", disabled: locked || !value.asset, run: () => set({ asset: null }) }],
  });
  const onDrop = (e: DragEvent) => {
    setOver(false);
    if (locked) return;
    const id = e.dataTransfer.getData("application/x-kk-asset");
    if (id && provider.get(id)) {
      e.preventDefault();
      set({ asset: id });
      return;
    }
    if (e.dataTransfer.files.length && onDropFiles) {
      e.preventDefault();
      onDropFiles(Array.from(e.dataTransfer.files));
    }
  };
  const thumbStyle = asset?.thumb
    ? { backgroundImage: `url("${asset.thumb}")` }
    : { background: KIND_COLORS[value.defaultKind] };
  return (
    <div
      ref={ref}
      {...ctx}
      data-kk="texture-slot"
      data-no-pan=""
      data-density={density}
      className={cx(
        "kk-tex",
        `kk-tex--${density}`,
        locked && "is-disabled",
        mixed && "is-mixed",
        invalid && "is-invalid",
        over && "is-dragover",
        modified && "is-modified",
        className,
      )}
      title={invalid ? message : tooltip}
      onDragOver={(e) => {
        if (!locked) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className="kk-tex__row">
        <button
          ref={btn}
          type="button"
          className="kk-tex__thumb kk-checker"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={props["aria-label"] ?? "Texture"}
          onClick={() => !readOnly && setOpen((o) => !o)}
        >
          {mixed ? (
            <span className="kk-tex__mixed">{"\u2014"}</span>
          ) : (
            <span className="kk-tex__img" style={thumbStyle}>
              {value.asset && !asset && <ImageOff size={14} />}
            </span>
          )}
        </button>
        <div className="kk-tex__meta">
          <span className="kk-tex__name" title={asset?.name}>
            {mixed ? "Mixed" : value.asset ? (asset?.name ?? "Missing asset") : "None"}
          </span>
          <span className="kk-tex__sub">
            {value.asset ? (asset?.info ?? value.asset) : `Default: ${value.defaultKind}`}
          </span>
        </div>
        {value.asset && !locked && (
          <button
            type="button"
            className="kk-minibtn kk-minibtn--icon"
            aria-label="Clear texture"
            title="Clear"
            onClick={() => set({ asset: null })}
          >
            <X size={12} />
          </button>
        )}
      </div>
      {!value.asset && !mixed && (
        <Select<TextureDefaultKind>
          value={value.defaultKind}
          options={KINDS}
          onChange={(k) => onChange?.({ ...value, defaultKind: k })}
          onCommit={(k) => onCommit?.({ ...value, defaultKind: k })}
          density="compact"
          disabled={disabled}
          readOnly={readOnly}
          aria-label="Default texture"
        />
      )}
      {showTransform && (
        <div className="kk-tex__xf">
          <Vec2Field
            value={value.tiling}
            labels={["Tiling X", "Y"]}
            step={0.01}
            density="compact"
            disabled={disabled}
            readOnly={readOnly}
            linkable
            aria-label="Tiling"
            onChange={(v) => onChange?.({ ...value, tiling: v as [number, number] })}
            onCommit={(v) => onCommit?.({ ...value, tiling: v as [number, number] })}
          />
          <Vec2Field
            value={value.offset}
            labels={["Offset X", "Y"]}
            step={0.01}
            density="compact"
            disabled={disabled}
            readOnly={readOnly}
            linkable
            aria-label="Offset"
            onChange={(v) => onChange?.({ ...value, offset: v as [number, number] })}
            onCommit={(v) => onCommit?.({ ...value, offset: v as [number, number] })}
          />
        </div>
      )}
      <Popover open={open} anchor={btn.current} onClose={() => setOpen(false)} ariaLabel="Choose texture" width={252}>
        <div className="kk-assetpick">
          <TextField
            value={query}
            onChange={setQuery}
            placeholder="Search assets…"
            prefix={<Search size={12} />}
            density="compact"
            clearable
            aria-label="Search assets"
            autoFocus
          />
          <div className="kk-assetpick__grid" role="listbox" aria-label="Assets">
            <button
              type="button"
              role="option"
              aria-selected={!value.asset}
              className={cx("kk-asset", !value.asset && "is-selected")}
              onClick={() => {
                set({ asset: null });
                setOpen(false);
              }}
            >
              <span className="kk-asset__img kk-checker">
                <ImageOff size={16} />
              </span>
              <span className="kk-asset__name">None</span>
            </button>
            {provider.list(query).map((a) => (
              <button
                key={a.id}
                type="button"
                role="option"
                aria-selected={a.id === value.asset}
                draggable
                className={cx("kk-asset", a.id === value.asset && "is-selected")}
                onDragStart={(e) => e.dataTransfer.setData("application/x-kk-asset", a.id)}
                onClick={() => {
                  set({ asset: a.id });
                  setOpen(false);
                }}
              >
                <span
                  className="kk-asset__img kk-checker"
                  style={a.thumb ? { backgroundImage: `url("${a.thumb}")` } : undefined}
                />
                <span className="kk-asset__name" title={a.name}>
                  {a.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      </Popover>
    </div>
  );
}
