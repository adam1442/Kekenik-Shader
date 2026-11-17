import { AlertTriangle, Box, FolderOpen, Image as ImageIcon, Sun, Upload } from "lucide-react";
import { useEffect, useMemo, useState, type DragEvent } from "react";
import { create } from "zustand";
import { EmptyState, SearchField, SegmentedControl, TextField, IconButton } from "@/ui";
import type { PanelProps } from "@/app/dock/panelRegistry";
import { importAndUse, importFromPicker, useAsset as applyPreviewAsset } from "../actions";
import { type AssetMeta, ensureAssetsLoaded, useAssets } from "../assets/assetStore";
import { type AssetKind, formatBytes } from "../assets/classify";
import { referencedAssetIds, usePreview } from "../previewStore";

/** UI-only state shared with the context-menu provider (which sets `renaming`). */
export const useAssetUi = create<{ renaming: string | null; setRenaming: (id: string | null) => void }>((set) => ({
  renaming: null,
  setRenaming: (renaming) => set({ renaming }),
}));

type Filter = "all" | AssetKind;
const ICON = { model: Box, texture: ImageIcon, hdr: Sun } as const;

function Tile({ a, unused }: { a: AssetMeta; unused: boolean }) {
  const renaming = useAssetUi((s) => s.renaming === a.id);
  const Icon = ICON[a.kind];
  return (
    <div
      className="kk-asset-tile"
      draggable
      data-ctx-scope="assets.item"
      data-ctx-id={a.id}
      data-testid="asset-tile"
      data-asset-id={a.id}
      title={`${a.name}\n${formatBytes(a.size)}${a.width ? ` · ${a.width}×${a.height}` : ""}${a.warning ? `\n⚠ ${a.warning}` : ""}`}
      onDragStart={(e: DragEvent) => {
        e.dataTransfer.setData("application/x-kk-asset", a.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onDoubleClick={() => applyPreviewAsset(a.id)}
    >
      <div
        className="kk-asset-tile__img kk-checker"
        style={a.thumb ? { backgroundImage: `url("${a.thumb}")` } : undefined}
      >
        {!a.thumb && <Icon size={22} />}
      </div>
      <div className="kk-asset-tile__badges">
        <span className="kk-asset-tile__kind">{a.kind === "hdr" ? "HDR" : a.ext.toUpperCase()}</span>
        {a.warning && <AlertTriangle size={11} className="is-warn" aria-label="Size warning" />}
        {unused && (
          <span className="kk-asset-tile__unused" title="Not used by the project">
            unused
          </span>
        )}
      </div>
      {renaming ? (
        <TextField
          density="compact"
          autoFocus
          value={a.name}
          aria-label="Asset name"
          onCommit={(v) => {
            void import("../assets/assetStore").then((m) => m.renameAsset(a.id, v));
            useAssetUi.getState().setRenaming(null);
          }}
          onCancel={() => useAssetUi.getState().setRenaming(null)}
        />
      ) : (
        <span className="kk-asset-tile__name">{a.name}</span>
      )}
    </div>
  );
}

/** Assets panel: import, filter, thumbnails, rename / delete (context menu), drag onto the Preview or a texture slot. */
export function AssetsPanel(_p: PanelProps) {
  const items = useAssets((s) => s.items);
  const ready = useAssets((s) => s.ready);
  const backend = useAssets((s) => s.backend);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [over, setOver] = useState(false);
  const used = usePreview((s) => [s.modelAssetId, s.spriteAssetId, s.hdrAssetId, JSON.stringify(s.bindings)].join("|"));
  useEffect(() => void ensureAssetsLoaded(), []);
  const refs = useMemo(() => referencedAssetIds(), [used, items]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = items.filter(
    (a) => (filter === "all" || a.kind === filter) && (!q || a.name.toLowerCase().includes(q.toLowerCase())),
  );
  const onDrop = (e: DragEvent) => {
    setOver(false);
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    void importAndUse(Array.from(e.dataTransfer.files), { use: false });
  };
  return (
    <div
      className={`kk-assets${over ? " is-over" : ""}`}
      data-testid="assets-panel"
      data-ctx-scope={items.length ? undefined : "assets.empty"}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className="kk-gp__bar">
        <SearchField value={q} onChange={setQ} placeholder="Search assets…" size="sm" />
        <SegmentedControl<Filter>
          density="compact"
          value={filter}
          onChange={setFilter}
          aria-label="Asset filter"
          options={[
            { value: "all", label: "All" },
            { value: "model", label: "Models" },
            { value: "texture", label: "Images" },
            { value: "hdr", label: "HDR" },
          ]}
        />
        <IconButton icon={Upload} label="Import assets…" size="sm" onClick={() => void importFromPicker()} />
      </div>
      <div className="kk-gp__scroll" data-ctx-scope="assets.empty">
        {!ready ? null : shown.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title={items.length ? "No matches" : "No assets yet"}
            description={
              items.length
                ? "Try another search or filter."
                : "Import GLB / GLTF / OBJ / FBX models, PNG / JPG / WebP images and .hdr environments — or drop files here."
            }
          />
        ) : (
          <div className="kk-assets__grid">
            {shown.map((a) => (
              <Tile key={a.id} a={a} unused={!refs.has(a.id)} />
            ))}
          </div>
        )}
      </div>
      <div className="kk-assets__foot">
        {items.length} asset{items.length === 1 ? "" : "s"} · {formatBytes(items.reduce((n, a) => n + a.size, 0))} ·{" "}
        {backend === "indexedDB" ? "saved in this browser" : "memory only (storage blocked) — not kept after reload"}
      </div>
    </div>
  );
}
