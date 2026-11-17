/**
 * Color math. Canonical model: LINEAR float RGBA (`Rgba`). r,g,b may exceed 1 (HDR); a is 0..1.
 * Picker-space values (HSV/HSL/hex/rgb()) are sRGB-encoded.
 */
import { clamp } from "./numeric";

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}
export interface Hsv {
  h: number; // 0..360
  s: number; // 0..1
  v: number; // 0..1
}
export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export const rgba = (r: number, g: number, b: number, a = 1): Rgba => ({ r, g, b, a });
export const WHITE: Rgba = { r: 1, g: 1, b: 1, a: 1 };
export const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

/** IEC 61966-2-1 knees — the ONE definition, also used by the IR emitters of the 8b colour nodes (core/nodes/visual/colorMath.ts). */
export const SRGB_DECODE_KNEE = 0.04045;
export const SRGB_ENCODE_KNEE = 0.0031308;
export function srgbToLinear(c: number): number {
  return c <= SRGB_DECODE_KNEE ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
export function linearToSrgb(c: number): number {
  return c <= SRGB_ENCODE_KNEE ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** sRGB-encoded 0..1 triple (clamped) of a linear color — what a monitor / picker shows. */
export function toSrgb(c: Rgba): [number, number, number] {
  return [linearToSrgb(clamp(c.r, 0, 1)), linearToSrgb(clamp(c.g, 0, 1)), linearToSrgb(clamp(c.b, 0, 1))];
}
export function fromSrgb(r: number, g: number, b: number, a = 1): Rgba {
  return { r: srgbToLinear(r), g: srgbToLinear(g), b: srgbToLinear(b), a };
}

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

export function rgbToHsl(r: number, g: number, b: number): Hsl {
  const { h, v: max } = rgbToHsv(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const v = l + c / 2;
  const sv = v === 0 ? 0 : 2 * (1 - l / v);
  return hsvToRgb(h, sv, v);
}

/* ── hex / css / json ─────────────────────────────────────────────────── */

const byte = (x: number) => Math.round(clamp(x, 0, 1) * 255);
const hex2 = (n: number) => n.toString(16).padStart(2, "0");

/** `#rrggbb` (or `#rrggbbaa` with `withAlpha`) of the sRGB-encoded, clamped color. */
export function toHex(c: Rgba, withAlpha = false): string {
  const [r, g, b] = toSrgb(c);
  return "#" + hex2(byte(r)) + hex2(byte(g)) + hex2(byte(b)) + (withAlpha ? hex2(byte(c.a)) : "");
}

const HEX_RE = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Parse #rgb #rgba #rrggbb #rrggbbaa (sRGB-encoded) → linear Rgba; null when invalid. */
export function fromHex(text: string): Rgba | null {
  const m = HEX_RE.exec(text.trim());
  if (!m) return null;
  let h = m[1]!.toLowerCase();
  if (h.length <= 4)
    h = h
      .split("")
      .map((ch) => ch + ch)
      .join("");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return fromSrgb(n(0), n(2), n(4), h.length === 8 ? n(6) : 1);
}

/** Normalised `#rrggbb` (3-digit expanded, lowercase) or null — kept for 1a compatibility. */
export function normalizeHex(input: string): string | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(input.trim());
  if (!m) return null;
  let h = m[1]!.toLowerCase();
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  return "#" + h;
}

/** `rgba(255, 128, 0, 0.5)` — sRGB-encoded 0..255. */
export function formatRgbaCss(c: Rgba): string {
  const [r, g, b] = toSrgb(c);
  return `rgba(${byte(r)}, ${byte(g)}, ${byte(b)}, ${Number(c.a.toFixed(3))})`;
}

/** Linear float JSON, e.g. `{"r":1,"g":0.5,"b":0,"a":1}` — lossless for HDR. */
export function formatColorJson(c: Rgba): string {
  const f = (x: number) => Number(x.toFixed(6));
  return JSON.stringify({ r: f(c.r), g: f(c.g), b: f(c.b), a: f(c.a) });
}

/** Parse hex, `rgb()/rgba()` (sRGB 0..255), or float JSON (`{r,g,b,a}` / `[r,g,b,a]`, linear). */
export function parseColor(text: string): Rgba | null {
  const s = text.trim();
  if (!s) return null;
  const hex = fromHex(s);
  if (hex) return hex;
  const css = /^rgba?\(\s*([^)]*)\)$/i.exec(s);
  if (css) {
    const p = css[1]!
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    if ((p.length === 3 || p.length === 4) && p.every(Number.isFinite)) {
      return fromSrgb(
        clamp(p[0]! / 255, 0, 1),
        clamp(p[1]! / 255, 0, 1),
        clamp(p[2]! / 255, 0, 1),
        p.length === 4 ? clamp(p[3]!, 0, 1) : 1,
      );
    }
    return null;
  }
  if (s.startsWith("{") || s.startsWith("[")) {
    try {
      const j: unknown = JSON.parse(s);
      let arr: unknown[] | null = null;
      if (Array.isArray(j)) arr = j;
      else if (j && typeof j === "object") {
        const o = j as Record<string, unknown>;
        arr = [o.r, o.g, o.b, o.a ?? 1];
      }
      if (
        arr &&
        (arr.length === 3 || arr.length === 4) &&
        arr.every((x) => typeof x === "number" && Number.isFinite(x))
      ) {
        const n = arr as number[];
        return { r: n[0]!, g: n[1]!, b: n[2]!, a: clamp(n[3] ?? 1, 0, 1) };
      }
    } catch {
      return null;
    }
  }
  return null;
}

/* ── HDR: color = base × 2^EV ─────────────────────────────────────────── */

export const EV_MIN = -10;
export const EV_MAX = 10;

/** Split an HDR linear color into a displayable base (max channel ≤ 1) and an EV intensity (≥ 0 when brighter than 1). */
export function decomposeEv(c: Rgba): { base: Rgba; ev: number } {
  const m = Math.max(c.r, c.g, c.b);
  if (m <= 1) return { base: { ...c }, ev: 0 };
  return { base: { r: c.r / m, g: c.g / m, b: c.b / m, a: c.a }, ev: Math.log2(m) };
}

export function applyEv(base: Rgba, ev: number): Rgba {
  const k = Math.pow(2, clamp(ev, EV_MIN, EV_MAX));
  return { r: base.r * k, g: base.g * k, b: base.b * k, a: base.a };
}

/** Exposure strip: the color seen at each EV offset (tone-clipped, ready to be shown as sRGB). */
export function exposureStrip(c: Rgba, from = -3, to = 3): Array<{ ev: number; color: Rgba }> {
  const out: Array<{ ev: number; color: Rgba }> = [];
  for (let ev = from; ev <= to; ev++) out.push({ ev, color: applyEv(c, ev) });
  return out;
}

/** CSS color string for any linear color (clamped to displayable range). */
export function toCssColor(c: Rgba): string {
  return formatRgbaCss(c);
}

export function colorsEqual(a: Rgba, b: Rgba, eps = 0): boolean {
  return (
    Math.abs(a.r - b.r) <= eps && Math.abs(a.g - b.g) <= eps && Math.abs(a.b - b.b) <= eps && Math.abs(a.a - b.a) <= eps
  );
}

export function luminance(c: Rgba): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}
