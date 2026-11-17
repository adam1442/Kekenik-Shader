import { stableStringify } from "./stable";

/** One asset (texture) embedded in a project file. */
export interface EmbeddedAsset {
  id: string;
  name: string;
  mime: string;
  /** Raw file bytes, base64. */
  dataBase64: string;
}
export interface EmbeddedPayload {
  assets: EmbeddedAsset[];
  /** Texture property id → asset id (so the preview shows the same textures after opening). */
  bindings: Record<string, string>;
}

/** Top-level key of the `.kshader` document that carries the optional payload (ignored by older readers). */
const EMBED_KEY = "embeddedAssets";

/** Add the payload to serialized `.kshader` text (deterministic; no-op for an empty payload). */
export function embedPayload(text: string, payload: EmbeddedPayload): string {
  if (payload.assets.length === 0) return text;
  const doc = JSON.parse(text) as Record<string, unknown>;
  doc[EMBED_KEY] = payload;
  return stableStringify(doc, 2) + "\n";
}

/** Payload of a `.kshader` text, or null when there is none / it is malformed (never throws). */
export function readEmbedded(text: string): EmbeddedPayload | null {
  try {
    const p = (JSON.parse(text) as Record<string, unknown>)[EMBED_KEY] as Partial<EmbeddedPayload> | undefined;
    if (!p || !Array.isArray(p.assets)) return null;
    const assets = p.assets.filter(
      (a): a is EmbeddedAsset =>
        !!a &&
        typeof a.id === "string" &&
        typeof a.name === "string" &&
        typeof a.mime === "string" &&
        typeof a.dataBase64 === "string",
    );
    const bindings = Object.fromEntries(
      Object.entries(p.bindings ?? {}).filter(([, v]) => typeof v === "string"),
    ) as Record<string, string>;
    return assets.length ? { assets, bindings } : null;
  } catch {
    return null;
  }
}
