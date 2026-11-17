import { DEFAULT_TEXTURE, TextureSlot, type TextureDefaultKind } from "@/ui";
import type { Property, TextureDefault } from "@/core";
import { assetProvider } from "../assets/assetStore";
import { importAndUse } from "../actions";
import { usePreview } from "../previewStore";

/** Property model (`grey`, `none`) → TextureSlot control vocabulary (`gray`). `none` renders as white (what the shader samples). */
const slotKindOf = (p: Pick<Property, "textureDefault">): TextureDefaultKind =>
  p.textureDefault === "grey" ? "gray" : p.textureDefault && p.textureDefault !== "none" ? p.textureDefault : "white";

/** Control vocabulary → Property model. */
const propertyKindOf = (k: TextureDefaultKind): TextureDefault => (k === "gray" ? "grey" : k);

type V2 = [number, number];
interface Props {
  p: Property;
  /** Tiling / offset editing (the slot shows the extra fields only when given). */
  transform?: { tiling: V2; offset: V2; onChange: (tiling: V2, offset: V2) => void };
  /** Called when the user picks another default texture kind in the slot. */
  onDefaultKind?: (kind: TextureDefault) => void;
}

const NO_TRANSFORM = { tiling: [1, 1] as V2, offset: [0, 0] as V2 };

/**
 * THE editor of a texture property's runtime binding (property id → asset id lives in `usePreview.bindings`).
 * Used by the Material panel and the Preview drawer's Inputs tab so both bind, drop and reset identically.
 */
export function PropertyTextureSlot({ p, transform, onDefaultKind }: Props) {
  const bound = usePreview((s) => s.bindings[p.id] ?? null);
  const bind = usePreview((s) => s.bind);
  const kind = slotKindOf(p);
  const t = transform ?? NO_TRANSFORM;
  return (
    <TextureSlot
      density="compact"
      provider={assetProvider}
      showTransform={!!transform}
      aria-label={`${p.displayName} texture`}
      value={{ ...DEFAULT_TEXTURE, asset: bound, defaultKind: kind, tiling: t.tiling, offset: t.offset }}
      onChange={(v) => {
        if (v.asset !== bound) bind(p.id, v.asset);
        if (onDefaultKind && v.defaultKind !== kind) onDefaultKind(propertyKindOf(v.defaultKind));
        if (
          transform &&
          (v.tiling[0] !== t.tiling[0] ||
            v.tiling[1] !== t.tiling[1] ||
            v.offset[0] !== t.offset[0] ||
            v.offset[1] !== t.offset[1])
        )
          transform.onChange([v.tiling[0], v.tiling[1]], [v.offset[0], v.offset[1]]);
      }}
      onDropFiles={(files) =>
        void importAndUse(files, { use: false }).then((r) => {
          const a = r.find((x) => x.ok && x.asset?.kind === "texture")?.asset;
          if (a) bind(p.id, a.id);
        })
      }
    />
  );
}
