import { useState } from "react";
import { Button, Checkbox, Modal, Select } from "@/ui";
import { useHalfEmulation } from "@/preview/logic/halfEmulation";
import { hasWebGl2 } from "@/webgl/context";
import { useShader } from "../shaderStore";
import { BENCH_VARIANTS, type BenchRow, runBenchmark } from "./benchmark";
import { useProUi } from "./proState";

const SIZES = [256, 512, 1024].map((n) => ({ value: String(n), label: `${n} × ${n}` }));
const fmt = (ms: number): string => (ms >= 1 ? ms.toFixed(2) : ms.toFixed(3));

/** GPU benchmark + A/B compare + fp16 emulation switch (O1 / O7). Numbers are relative, for THIS GPU only. */
export function BenchmarkDialog() {
  const open = useProUi((s) => s.benchOpen);
  const graph = useShader((s) => s.graph);
  const emu = useHalfEmulation();
  const [size, setSize] = useState("512");
  const [ids, setIds] = useState<string[]>(["opt0", "opt2", "half"]);
  const [rows, setRows] = useState<BenchRow[]>([]);
  const [busy, setBusy] = useState<string>("");
  const webgl = hasWebGl2();
  const run = async (): Promise<void> => {
    if (!graph || busy) return;
    setBusy("Running…");
    setRows([]);
    try {
      setRows(
        await runBenchmark(graph, {
          size: Number(size),
          passes: 24,
          samples: 5,
          ids,
          onProgress: (d, t) => setBusy(`Running ${Math.min(d + 1, t)} / ${t}…`),
        }),
      );
    } finally {
      setBusy("");
    }
  };
  const toggle = (id: string, on: boolean): void => setIds(on ? [...ids, id] : ids.filter((x) => x !== id));
  const method = rows[0]?.result.method;
  return (
    <Modal
      open={open}
      onClose={() => useProUi.getState().set({ benchOpen: false })}
      title={`Performance${graph ? ` — ${graph.name || "Untitled"}` : ""}`}
      width={680}
      footer={
        <>
          <Button variant="ghost" onClick={() => useProUi.getState().set({ benchOpen: false })}>
            Close
          </Button>
          <Button variant="primary" disabled={!graph || !webgl || !!busy} onClick={() => void run()}>
            {busy || "Run benchmark"}
          </Button>
        </>
      }
    >
      <div className="kk-pro" style={{ padding: 0 }} data-kk="benchmark">
        <h3>fp16 emulation (preview)</h3>
        <Checkbox
          label="Emulate half precision in the preview"
          checked={emu.on}
          onChange={emu.set}
          tooltip="Rounds every temporary the precision pass marked half to binary16 (packHalf2x16 / unpackHalf2x16) so banding and precision artefacts become visible on a desktop GPU. Set Graph → Precision to Auto or Half first. Never part of an export."
        />
        <h3>GPU benchmark — A/B compare</h3>
        {!webgl && (
          <div className="kk-pro__muted">
            WebGL2 is not available in this browser context — the benchmark cannot run.
          </div>
        )}
        <div className="kk-pro__row" style={{ gridTemplateColumns: "1fr" }}>
          <Select<string> value={size} options={SIZES} aria-label="Benchmark resolution" onChange={setSize} />
        </div>
        <div className="kk-pro__chips">
          {BENCH_VARIANTS.filter((v) => v.id !== "current").map((v) => (
            <Checkbox
              key={v.id}
              label={v.label}
              checked={ids.includes(v.id)}
              onChange={(c) => toggle(v.id, c)}
              tooltip={v.hint}
            />
          ))}
        </div>
        {rows.length > 0 && (
          <table className="kk-pro__table" data-kk="benchmark-table">
            <thead>
              <tr>
                <th>Variant</th>
                <th>ms / pass</th>
                <th>vs current</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.variant.id} title={r.variant.hint}>
                  <td>{r.variant.label}</td>
                  <td>
                    {r.result.ok ? (
                      fmt(r.result.msPerPass)
                    ) : (
                      <span className="kk-pro__muted">{r.result.log || "failed"}</span>
                    )}
                  </td>
                  <td>
                    {r.ratio === null
                      ? "—"
                      : r.variant.id === "current"
                        ? "baseline"
                        : `×${r.ratio.toFixed(2)} ${r.ratio < 0.97 ? "(faster)" : r.ratio > 1.03 ? "(slower)" : "(same)"}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="kk-pro__muted" data-kk="benchmark-note">
          {method === "fenced"
            ? "Low reliability: no GPU timer query on this browser — timings come from a fenced performance.now() loop (coarse clock). "
            : ""}
          Relative numbers for THIS GPU and driver only: full-screen passes at a fixed resolution, never an engine frame
          time. Differences under ~3 % are noise.
        </div>
      </div>
    </Modal>
  );
}
