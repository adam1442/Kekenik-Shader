import { Clipboard, Copy, Pipette, Plus } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  applyEv,
  colorsEqual,
  decomposeEv,
  exposureStrip,
  formatColorJson,
  formatRgbaCss,
  fromHex,
  fromSrgb,
  hslToRgb,
  hsvToRgb,
  linearToSrgb,
  parseColor,
  rgbToHsl,
  rgbToHsv,
  srgbToLinear,
  toCssColor,
  toHex,
  toSrgb,
  EV_MAX,
  EV_MIN,
  type Rgba,
} from "@/core/values/color";
import { clamp } from "@/core/values/numeric";
import { cx } from "../util/cx";
import { copyText, pasteText } from "./clipboard";
import { DragSurface } from "./DragSurface";
import { NumberField } from "./NumberField";
import { SegmentedControl } from "./Segmented";
import { Slider } from "./Slider";
import { swatchStore } from "./swatchStore";
import { TextField } from "./TextField";

export interface ColorPickerProps {
  value: Rgba;
  onChange?: (c: Rgba) => void;
  onCommit?: (c: Rgba) => void;
  onCancel?: () => void;
  hdr?: boolean;
  alpha?: boolean;
  className?: string;
}

type Mode = "rgb" | "hsv" | "hsl" | "hex";
const hasEyeDropper = () => typeof window !== "undefined" && "EyeDropper" in window;

/** Colour picker body (SV square, hue, alpha, numeric modes, HDR EV, exposure strip, swatches, eyedropper). Linear RGBA model. */
export function ColorPicker({ value, onChange, onCommit, onCancel, hdr, alpha = true, className }: ColorPickerProps) {
  const init = decomposeEv(value);
  const sInit = toSrgb(init.base);
  const hsvInit = rgbToHsv(sInit[0], sInit[1], sInit[2]);
  const [st, setSt] = useState({ h: hsvInit.h, s: hsvInit.s, v: hsvInit.v, a: value.a, ev: init.ev });
  const [mode, setMode] = useState<Mode>("rgb");
  const [display, setDisplay] = useState<"srgb" | "linear">("srgb");
  const before = useRef(value);
  const emitted = useRef(value);
  const startRef = useRef(value);
  const swatches = useSyncExternalStore(swatchStore.subscribe, () =>
    JSON.stringify([swatchStore.swatches(), swatchStore.recents()]),
  );
  const [sw, rc] = JSON.parse(swatches) as [Rgba[], Rgba[]];

  const toColor = (s: typeof st): Rgba => {
    const [r, g, b] = hsvToRgb(s.h, s.s, s.v);
    const base = fromSrgb(r, g, b, s.a);
    return hdr ? applyEv(base, s.ev) : base;
  };
  // External value changes (not our own emissions) resync the HSV state while keeping hue when it is undefined.
  useEffect(() => {
    if (colorsEqual(value, emitted.current, 1e-6)) return;
    const d = decomposeEv(value);
    const [r, g, b] = toSrgb(d.base);
    const hv = rgbToHsv(r, g, b);
    setSt((p) => ({ h: hv.s > 0 && hv.v > 0 ? hv.h : p.h, s: hv.s, v: hv.v, a: value.a, ev: d.ev }));
    emitted.current = value;
  }, [value]);

  const push = (next: typeof st, live = true) => {
    setSt(next);
    const c = toColor(next);
    emitted.current = c;
    if (live) onChange?.(c);
  };
  const commit = () => {
    onCommit?.(emitted.current);
    swatchStore.pushRecent(emitted.current);
  };
  const setColor = (c: Rgba, doCommit = true) => {
    const d = decomposeEv(hdr ? c : { ...c, r: clamp(c.r, 0, 1), g: clamp(c.g, 0, 1), b: clamp(c.b, 0, 1) });
    const [r, g, b] = toSrgb(d.base);
    const hv = rgbToHsv(r, g, b);
    const next = { h: hv.s > 0 && hv.v > 0 ? hv.h : st.h, s: hv.s, v: hv.v, a: alpha ? c.a : 1, ev: hdr ? d.ev : 0 };
    push(next);
    if (doCommit) commit();
  };
  const cancel = () => {
    setColor(startRef.current, false);
    onChange?.(startRef.current);
    onCancel?.();
  };

  const cur = toColor(st);
  const [sr, sg, sb] = toSrgb({
    ...cur,
    r: cur.r / (hdr ? Math.pow(2, st.ev) : 1),
    g: cur.g / (hdr ? Math.pow(2, st.ev) : 1),
    b: cur.b / (hdr ? Math.pow(2, st.ev) : 1),
  });
  const hsl = rgbToHsl(sr, sg, sb);
  const pure = `hsl(${st.h} 100% 50%)`;
  const eyedrop = async () => {
    try {
      const ED = (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } })
        .EyeDropper;
      const r = await new ED().open();
      const c = fromHex(r.sRGBHex);
      if (c) setColor({ ...c, a: st.a });
    } catch {
      /* user cancelled */
    }
  };
  const setFromPaste = async () => {
    const c = parseColor(await pasteText());
    if (c) setColor(c);
  };

  const rgbField = (i: 0 | 1 | 2, name: string) => {
    const lin = display === "linear";
    const srgb = [sr, sg, sb];
    const v = lin
      ? [srgbToLinear(sr), srgbToLinear(sg), srgbToLinear(sb)][i]! * (hdr ? Math.pow(2, st.ev) : 1)
      : srgb[i]! * 255;
    return (
      <NumberField
        key={name}
        label={name}
        aria-label={name}
        density="compact"
        value={v}
        min={0}
        max={lin ? (hdr ? 1024 : 1) : 255}
        step={lin ? 0.01 : 1}
        precision={lin ? 4 : 0}
        onChange={(x) => {
          const comp = [...srgb];
          comp[i] = lin ? linearToSrgb(x / (hdr ? Math.pow(2, st.ev) : 1)) : x / 255;
          const hv = rgbToHsv(clamp(comp[0]!, 0, 1), clamp(comp[1]!, 0, 1), clamp(comp[2]!, 0, 1));
          push({ ...st, h: hv.s > 0 ? hv.h : st.h, s: hv.s, v: hv.v });
        }}
        onCommit={commit}
      />
    );
  };

  return (
    <div className={cx("kk-cp", className)} data-kk="color-picker" data-no-pan="">
      <DragSurface
        className="kk-cp__sv"
        style={{ background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,${pure})` }}
        role="slider"
        aria-label="Saturation and brightness"
        aria-valuetext={`S ${Math.round(st.s * 100)}% V ${Math.round(st.v * 100)}%`}
        onBegin={() => (startRef.current = emitted.current)}
        onPoint={(u, v) => push({ ...st, s: u, v: 1 - v })}
        onEnd={(c) => (c ? cancel() : commit())}
        onKeyDown={(e) => {
          const d = e.shiftKey ? 0.01 : 0.05;
          const m: Record<string, [number, number]> = {
            ArrowLeft: [-d, 0],
            ArrowRight: [d, 0],
            ArrowUp: [0, d],
            ArrowDown: [0, -d],
          };
          if (!m[e.key]) return;
          e.preventDefault();
          push({ ...st, s: clamp(st.s + m[e.key]![0], 0, 1), v: clamp(st.v + m[e.key]![1], 0, 1) });
          commit();
        }}
      >
        <span className="kk-cp__puck" style={{ left: `${st.s * 100}%`, top: `${(1 - st.v) * 100}%` }} />
      </DragSurface>
      <DragSurface
        className="kk-cp__hue"
        role="slider"
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(st.h)}
        onBegin={() => (startRef.current = emitted.current)}
        onPoint={(u) => push({ ...st, h: u * 360 })}
        onEnd={(c) => (c ? cancel() : commit())}
        onKeyDown={(e) => {
          const d = e.shiftKey ? 1 : 5;
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          push({ ...st, h: (st.h + (e.key === "ArrowRight" ? d : -d) + 360) % 360 });
          commit();
        }}
      >
        <span className="kk-cp__knob" style={{ left: `${(st.h / 360) * 100}%`, background: pure }} />
      </DragSurface>
      {alpha && (
        <DragSurface
          className="kk-cp__alpha kk-checker"
          role="slider"
          aria-label="Alpha"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={Number(st.a.toFixed(3))}
          onBegin={() => (startRef.current = emitted.current)}
          onPoint={(u) => push({ ...st, a: u })}
          onEnd={(c) => (c ? cancel() : commit())}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            push({ ...st, a: clamp(st.a + (e.key === "ArrowRight" ? 0.05 : -0.05), 0, 1) });
            commit();
          }}
        >
          <span
            className="kk-cp__alphafill"
            style={{
              background: `linear-gradient(to right, transparent, ${toCssColor({ ...toColor({ ...st, a: 1 }), r: clamp(cur.r, 0, 1), g: clamp(cur.g, 0, 1), b: clamp(cur.b, 0, 1), a: 1 })})`,
            }}
          />
          <span className="kk-cp__knob" style={{ left: `${st.a * 100}%` }} />
        </DragSurface>
      )}

      <div className="kk-cp__row">
        <div className="kk-cp__compare" title="Before / after (click “before” to revert)">
          <button
            type="button"
            className="kk-cp__before kk-checker"
            aria-label="Revert to original color"
            onClick={() => setColor(before.current)}
          >
            <span style={{ background: toCssColor(before.current) }} />
          </button>
          <span className="kk-cp__after kk-checker" aria-label="Current color">
            <span style={{ background: toCssColor(cur) }} />
          </span>
        </div>
        <SegmentedControl<Mode>
          value={mode}
          onChange={setMode}
          density="compact"
          aria-label="Numeric mode"
          options={[
            { value: "rgb", label: "RGB" },
            { value: "hsv", label: "HSV" },
            { value: "hsl", label: "HSL" },
            { value: "hex", label: "Hex" },
          ]}
        />
        {hasEyeDropper() && (
          <button
            type="button"
            className="kk-minibtn kk-minibtn--icon"
            onClick={eyedrop}
            aria-label="Pick color from screen"
            title="Eyedropper"
          >
            <Pipette size={13} />
          </button>
        )}
      </div>

      <div className="kk-cp__nums">
        {mode === "rgb" && (
          <>
            {rgbField(0, "R")}
            {rgbField(1, "G")}
            {rgbField(2, "B")}
          </>
        )}
        {mode === "hsv" && (
          <>
            <NumberField
              label="H"
              aria-label="Hue"
              density="compact"
              value={st.h}
              min={0}
              max={360}
              step={1}
              precision={0}
              unit="°"
              onChange={(x) => push({ ...st, h: x })}
              onCommit={commit}
            />
            <NumberField
              label="S"
              aria-label="Saturation"
              density="compact"
              value={st.s * 100}
              min={0}
              max={100}
              step={1}
              precision={0}
              unit="%"
              onChange={(x) => push({ ...st, s: x / 100 })}
              onCommit={commit}
            />
            <NumberField
              label="V"
              aria-label="Value"
              density="compact"
              value={st.v * 100}
              min={0}
              max={100}
              step={1}
              precision={0}
              unit="%"
              onChange={(x) => push({ ...st, v: x / 100 })}
              onCommit={commit}
            />
          </>
        )}
        {mode === "hsl" && (
          <>
            {(
              [
                ["H", hsl.h, 360, "°"],
                ["S", hsl.s * 100, 100, "%"],
                ["L", hsl.l * 100, 100, "%"],
              ] as const
            ).map(([n, v, mx, u], i) => (
              <NumberField
                key={n}
                label={n}
                aria-label={n}
                density="compact"
                value={v}
                min={0}
                max={mx}
                step={1}
                precision={0}
                unit={u}
                onChange={(x) => {
                  const c = [hsl.h, hsl.s, hsl.l];
                  c[i] = i === 0 ? x : x / 100;
                  const rgb = hslToRgb(c[0]!, c[1]!, c[2]!);
                  const hv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
                  push({ ...st, h: i === 0 ? x : hv.s > 0 ? hv.h : st.h, s: hv.s, v: hv.v });
                }}
                onCommit={commit}
              />
            ))}
          </>
        )}
        {mode === "hex" && (
          <TextField
            className="kk-cp__hex"
            aria-label="Hex color"
            density="compact"
            prefix="#"
            value={toHex({ ...fromSrgb(sr, sg, sb), a: st.a }, alpha).slice(1)}
            mono
            onCommit={(t) => {
              const c = fromHex(t);
              if (c) setColor({ ...c, a: alpha && t.replace("#", "").length > 6 ? c.a : st.a });
            }}
            validate={(t) => (fromHex(t) ? null : "Use #rgb, #rrggbb or #rrggbbaa")}
          />
        )}
        {alpha && mode !== "hex" && (
          <NumberField
            label="A"
            aria-label="Alpha"
            density="compact"
            value={st.a * 100}
            min={0}
            max={100}
            step={1}
            precision={0}
            unit="%"
            onChange={(x) => push({ ...st, a: x / 100 })}
            onCommit={commit}
          />
        )}
      </div>

      {hdr && (
        <div className="kk-cp__hdr">
          <Slider
            label="Intensity"
            aria-label="Intensity (EV)"
            density="compact"
            value={st.ev}
            min={EV_MIN}
            max={EV_MAX}
            step={0.1}
            precision={2}
            unit=" EV"
            defaultValue={0}
            onChange={(x) => push({ ...st, ev: x })}
            onCommit={commit}
          />
          <div className="kk-cp__strip" aria-label="Exposure strip">
            {exposureStrip({ ...cur }).map(({ ev, color }) => (
              <span
                key={ev}
                className="kk-cp__stripcell"
                title={`${ev > 0 ? "+" : ""}${ev} EV`}
                style={{ background: toCssColor(color) }}
              >
                <i>{ev > 0 ? `+${ev}` : ev}</i>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="kk-cp__row kk-cp__row--between">
        <SegmentedControl<"srgb" | "linear">
          value={display}
          onChange={setDisplay}
          density="compact"
          aria-label="Value space"
          options={[
            { value: "srgb", label: "sRGB", title: "RGB fields show gamma-encoded 0–255 values" },
            { value: "linear", label: "Linear", title: "RGB fields show linear floats (what the shader receives)" },
          ]}
        />
        <span className="kk-cp__copy">
          <button
            type="button"
            className="kk-minibtn"
            onClick={() => void copyText(toHex(cur, alpha))}
            title="Copy hex"
          >
            <Copy size={11} /> Hex
          </button>
          <button
            type="button"
            className="kk-minibtn"
            onClick={() => void copyText(formatRgbaCss(cur))}
            title="Copy rgba()"
          >
            rgba
          </button>
          <button
            type="button"
            className="kk-minibtn"
            onClick={() => void copyText(formatColorJson(cur))}
            title="Copy linear float JSON"
          >
            JSON
          </button>
          <button
            type="button"
            className="kk-minibtn kk-minibtn--icon"
            onClick={() => void setFromPaste()}
            aria-label="Paste color"
            title="Paste (hex, rgba(), JSON)"
          >
            <Clipboard size={11} />
          </button>
        </span>
      </div>

      <div className="kk-cp__swatches" aria-label="Swatches">
        {sw.map((c, i) => (
          <button
            key={i}
            type="button"
            className="kk-swatch kk-checker"
            draggable
            aria-label={`Swatch ${toHex(c)}`}
            title={`${toHex(c)} — click to use, Alt-click to remove`}
            onDragStart={(e) => e.dataTransfer.setData("application/x-kk-color", JSON.stringify(c))}
            onClick={(e) => (e.altKey ? swatchStore.removeSwatch(i) : setColor({ ...c, a: alpha ? c.a : 1 }))}
          >
            <span style={{ background: toCssColor(c) }} />
          </button>
        ))}
        <button
          type="button"
          className="kk-swatch kk-swatch--add"
          aria-label="Add current color to swatches"
          title="Add to project swatches"
          onClick={() => swatchStore.addSwatch(emitted.current)}
        >
          <Plus size={11} />
        </button>
      </div>
      {rc.length > 0 && (
        <div className="kk-cp__swatches" aria-label="Recent colors">
          {rc.map((c, i) => (
            <button
              key={i}
              type="button"
              className="kk-swatch kk-checker"
              draggable
              aria-label={`Recent ${toHex(c)}`}
              title={`Recent ${toHex(c)}`}
              onDragStart={(e) => e.dataTransfer.setData("application/x-kk-color", JSON.stringify(c))}
              onClick={() => setColor({ ...c, a: alpha ? c.a : 1 })}
            >
              <span style={{ background: toCssColor(c) }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
