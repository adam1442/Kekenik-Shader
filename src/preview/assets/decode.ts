import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";

/** Load an image Blob into an HTMLImageElement (resolves when decoded). */
export function loadImage(blob: Blob): Promise<{ img: HTMLImageElement; url: string }> {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The image could not be decoded"));
    };
    img.src = url;
  });
}

export interface ImageInfo {
  width: number;
  height: number;
  thumb: string;
}

/** Decode an image and render a small PNG thumbnail (longest side `size`). */
export async function describeImage(blob: Blob, size = 96): Promise<ImageInfo> {
  const { img, url } = await loadImage(blob);
  try {
    const k = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return { width: img.naturalWidth, height: img.naturalHeight, thumb: c.toDataURL("image/png") };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface HdrData {
  width: number;
  height: number;
  /** Half-float RGBA (as produced by three's RGBELoader). */
  data: Uint16Array | Float32Array;
  type: number;
}

/** Parse a Radiance .hdr (RGBE) buffer. Throws on malformed files. */
export function parseHdr(buffer: ArrayBuffer): HdrData {
  const r = new RGBELoader().parse(buffer) as {
    width: number;
    height: number;
    data: Uint16Array | Float32Array;
    type: number;
  };
  if (!r || !r.width || !r.height || !r.data) throw new Error("Not a valid Radiance HDR file");
  return r;
}

const halfToFloat = (h: number): number => {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  const v = e === 0 ? (f / 1024) * 2 ** -14 : e === 31 ? (f ? NaN : Infinity) : (1 + f / 1024) * 2 ** (e - 15);
  return s ? -v : v;
};

/** Tone-mapped (Reinhard + gamma) thumbnail of an HDR image. */
export function hdrThumb(hdr: HdrData, size = 96): string {
  const w = Math.max(1, Math.min(hdr.width, size * 2));
  const h = Math.max(1, Math.round((hdr.height * w) / hdr.width));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const isHalf = hdr.data instanceof Uint16Array;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.floor((x / w) * hdr.width);
      const sy = Math.floor((y / h) * hdr.height); // RGBELoader data: row 0 = top of the image (texture.flipY = true)
      const o = (sy * hdr.width + sx) * 4;
      for (let k = 0; k < 3; k++) {
        const raw = hdr.data[o + k]!;
        const v = isHalf ? halfToFloat(raw) : raw;
        const t = Number.isFinite(v) ? v / (1 + v) : 1;
        img.data[(y * w + x) * 4 + k] = Math.round(255 * Math.pow(Math.max(0, t), 1 / 2.2));
      }
      img.data[(y * w + x) * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}
