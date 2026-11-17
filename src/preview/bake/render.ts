import type { BakeFormat, Graph } from "@/core";
import { ThumbRenderer } from "../thumbs/thumbRenderer";
import type { BakeAnalysis } from "./analysis";
import { type SeamReport, seamReport } from "./plan";

export interface BakeImage {
  width: number;
  height: number;
  /** RGBA8, top row first (row 0 = v = 1, the orientation of every PNG). */
  pixels: Uint8ClampedArray;
  png: Blob;
  seam: SeamReport;
}

const toPng = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("PNG encoding failed"))), "image/png"));

/**
 * Render the first output of `nodeId` into a `res × res` image through the SAME shader pipeline as the preview and the node thumbnails
 * (generic profile, UV0 over the unit quad, no stripe overlay). R8 bakes store the grey value in R = G = B (browsers cannot encode 1-channel PNGs).
 * Throws when WebGL is unavailable or the node does not compile.
 */
export async function renderBake(
  graph: Graph,
  nodeId: string,
  a: BakeAnalysis,
  res: number,
  format: BakeFormat,
): Promise<BakeImage> {
  const renderer = new ThumbRenderer();
  try {
    const entry = renderer.compile(graph, nodeId, { raw: true });
    if (!entry || !entry.ok) throw new Error(entry?.message || "The node could not be compiled for baking.");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = res;
    if (!renderer.render(entry, canvas, 0)) throw new Error("WebGL is unavailable — nothing was rendered.");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable.");
    const img = ctx.getImageData(0, 0, res, res);
    if (format === "r8")
      for (let i = 0; i < img.data.length; i += 4) {
        img.data[i + 1] = img.data[i]!;
        img.data[i + 2] = img.data[i]!;
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    return {
      width: res,
      height: res,
      pixels: img.data,
      png: await toPng(canvas),
      seam: seamReport(img.data, res, res, format === "r8" ? 1 : (a.channels ?? 3)),
    };
  } finally {
    renderer.dispose();
  }
}
