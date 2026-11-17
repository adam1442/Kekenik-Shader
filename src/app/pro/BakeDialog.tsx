import { useEffect, useMemo, useRef, useState } from "react";
import { BAKE_RESOLUTIONS, type BakeFormat, defaultNodeRegistry } from "@/core";
import { analyzeBake } from "@/preview/bake/analysis";
import { type BakeImage, renderBake } from "@/preview/bake/render";
import { Button, Modal, Select, TextField } from "@/ui";
import { getGraph } from "@/ui/graph/graphStore";
import { applyBake, applyRebake, bakeRecordOf } from "./bakeActions";
import { useProUi } from "./proState";

const FORMATS: Array<{ value: BakeFormat | "rgba16f"; label: string; disabled?: boolean }> = [
  { value: "rgba8", label: "RGBA8 (colour / vector)" },
  { value: "r8", label: "R8 (single channel mask)" },
  { value: "rgba16f", label: "RGBA16F — deferred (needs a half-float asset pipeline)", disabled: true },
];

/** Bake to Texture (O9): choose resolution / format, see the legality verdict, render, check tiling, replace the cone. */
export function BakeDialog() {
  const nodeId = useProUi((s) => s.bakeNode);
  const close = () => useProUi.getState().set({ bakeNode: null });
  const graph = nodeId ? getGraph() : undefined;
  const analysis = useMemo(() => (graph && nodeId ? analyzeBake(graph, nodeId) : undefined), [graph, nodeId]);
  const record = graph && nodeId ? bakeRecordOf(graph, nodeId) : undefined;
  const [res, setRes] = useState("512");
  const [format, setFormat] = useState<BakeFormat>("rgba8");
  const [name, setName] = useState("Baked");
  const [img, setImg] = useState<BakeImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!nodeId || !graph) return;
    setImg(null);
    setError("");
    const label =
      graph.nodes[nodeId]?.label || defaultNodeRegistry.get(graph.nodes[nodeId]?.defId ?? "")?.name || "Baked";
    setName(record ? (graph.properties.find((p) => p.id === record.prop)?.displayName ?? label) : label);
    if (record) {
      setRes(String(record.res));
      setFormat(record.format);
    }
  }, [nodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    c.width = img.width;
    c.height = img.height;
    c.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(img.pixels), img.width, img.height), 0, 0);
  }, [img]);

  if (!nodeId || !graph || !analysis)
    return (
      <Modal open={false} onClose={close} title="Bake to Texture">
        <span />
      </Modal>
    );
  const src = record ? graph.nodes[record.src] : graph.nodes[nodeId];
  const run = async (apply: boolean) => {
    setBusy(true);
    setError("");
    try {
      const a = record ? analyzeBake(graph, record.src) : analysis;
      const target = record ? record.src : nodeId;
      const image = await renderBake(graph, target, a, Number(res), format);
      setImg(image);
      if (!apply) return;
      const ok = record
        ? await applyRebake(record, { res: Number(res), format }, image)
        : !!(await applyBake(nodeId, a, { res: Number(res), format, name, tileable: image.seam.tileable }, image));
      if (ok) close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const effective = record ? analyzeBake(graph, record.src) : analysis;
  return (
    <Modal
      open
      onClose={close}
      title={`${record ? "Re-bake" : "Bake to Texture"} — ${src?.label || src?.defId || nodeId}`}
      width={560}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button disabled={!effective.ok || busy} onClick={() => void run(false)} data-kk="bake-preview">
            Render preview
          </Button>
          <Button
            variant="primary"
            disabled={!effective.ok || busy}
            onClick={() => void run(true)}
            data-kk="bake-apply"
          >
            {record ? "Re-bake" : "Bake & replace"}
          </Button>
        </>
      }
    >
      <div className="kk-pro" style={{ padding: 0 }} data-kk="bake-dialog">
        {effective.ok ? (
          <div className="kk-pro__muted">
            Depends only on UV and constants — safe to bake. The node's first output ({effective.type}) becomes one
            texture read; the original nodes stay in a detached “Baked source” group so you can re-bake.
          </div>
        ) : (
          <div role="alert" data-kk="bake-refusal">
            {effective.reasons.map((r) => (
              <div key={r} className="kk-pro__muted">
                {r}
              </div>
            ))}
          </div>
        )}
        <div className="kk-pro__row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <Select<string>
            value={res}
            options={BAKE_RESOLUTIONS.map((r) => ({ value: String(r), label: `${r} × ${r}` }))}
            aria-label="Resolution"
            onChange={setRes}
          />
          <Select<string>
            value={format}
            options={FORMATS.map((f) => ({ value: f.value, label: f.label, disabled: f.disabled }))}
            aria-label="Format"
            onChange={(v) => setFormat(v === "r8" ? "r8" : "rgba8")}
          />
          <TextField value={name} aria-label="Texture name" disabled={!!record} onChange={setName} />
        </div>
        {error && (
          <div role="alert" className="kk-pro__muted">
            {error}
          </div>
        )}
        {img && (
          <div data-kk="bake-result">
            <canvas ref={canvas} style={{ width: 192, height: 192, borderRadius: 6, imageRendering: "pixelated" }} />
            <div className="kk-pro__muted">
              {img.width}×{img.height} ·{" "}
              {img.seam.tileable
                ? "tileable (wrap-around seams match the image's own detail)"
                : `NOT seamless — edge difference ${Math.max(img.seam.horizontal, img.seam.vertical).toFixed(1)}/255 vs ${img.seam.neighbour.toFixed(1)} between neighbours`}{" "}
              · values outside 0…1 are clamped
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
