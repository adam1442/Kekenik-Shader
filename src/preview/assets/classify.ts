export type AssetKind = "model" | "texture" | "hdr";

const EXT: Record<string, AssetKind> = {
  glb: "model",
  gltf: "model",
  obj: "model",
  fbx: "model",
  png: "texture",
  jpg: "texture",
  jpeg: "texture",
  webp: "texture",
  hdr: "hdr",
};

export const ACCEPT_ALL = ".glb,.gltf,.obj,.fbx,.png,.jpg,.jpeg,.webp,.hdr";
export const ACCEPT_TEXTURES = ".png,.jpg,.jpeg,.webp";

const extOf = (name: string): string => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");

/** What kind of asset is this file (null = unsupported). */
export function classifyFile(name: string): { kind: AssetKind; ext: string } | null {
  const ext = extOf(name);
  const kind = EXT[ext];
  return kind ? { kind, ext } : null;
}

const MB = 1024 * 1024;

export const formatBytes = (n: number): string =>
  n >= MB ? `${(n / MB).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;

/** Human-readable warning for heavy assets (null = fine). Thresholds are deliberately generous: this is a preview. */
export function sizeWarning(kind: AssetKind, bytes: number, width?: number, height?: number): string | null {
  if (kind === "model" && bytes > 25 * MB)
    return `Large model (${formatBytes(bytes)}) — the preview may be slow to load and orbit.`;
  if (kind === "hdr" && bytes > 20 * MB) return `Large HDR (${formatBytes(bytes)}) — prefer 2k × 1k for the preview.`;
  if (kind === "texture") {
    if (width && height && Math.max(width, height) > 4096)
      return `Very large texture (${width}×${height}) — may exceed GPU limits on some devices.`;
    if (bytes > 12 * MB) return `Large texture file (${formatBytes(bytes)}).`;
  }
  return null;
}

export const mimeFor = (ext: string): string =>
  ({
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    glb: "model/gltf-binary",
    gltf: "model/gltf+json",
    obj: "text/plain",
    fbx: "application/octet-stream",
    hdr: "application/octet-stream",
  })[ext] ?? "application/octet-stream";
