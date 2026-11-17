import { useMemo, useState } from "react";
import {
  type OptLevel,
  type OptimizationReport,
  buildOptimizationReport,
  diffLines,
  diffStats,
  targetText,
} from "@/core";
import { Button, Modal, Select } from "@/ui";
import { useShader } from "../shaderStore";
import { useProUi } from "./proState";

const LEVEL_NAME: Record<OptLevel, string> = { 0: "Off (L0)", 1: "Safe (L1)", 2: "Fast-math (L2)" };
const pct = (a: number, b: number): string =>
  a > 0 ? `${b <= a ? "−" : "+"}${Math.abs(Math.round((1 - b / a) * 100))} %` : "—";

function Metrics({ rep }: { rep: OptimizationReport }) {
  const [l0, l1, l2] = rep.levels;
  const rows: Array<[string, number, number, number]> = [
    ["IR expressions", l0!.exprs, l1!.exprs, l2!.exprs],
    [
      "Fragment cost — desktop (ALU-eq.)",
      l0!.desktop.fragment.cost,
      l1!.desktop.fragment.cost,
      l2!.desktop.fragment.cost,
    ],
    ["Fragment cost — mobile (ALU-eq.)", l0!.mobile.fragment.cost, l1!.mobile.fragment.cost, l2!.mobile.fragment.cost],
    ["Vertex cost — desktop", l0!.desktop.vertex.cost, l1!.desktop.vertex.cost, l2!.desktop.vertex.cost],
    ["Texture samples", l0!.desktop.fragment.samples, l1!.desktop.fragment.samples, l2!.desktop.fragment.samples],
    [
      "Interpolators (vec4, packed)",
      l0!.desktop.interpolators.vec4Slots,
      l1!.desktop.interpolators.vec4Slots,
      l2!.desktop.interpolators.vec4Slots,
    ],
    [
      "Registers (vec4, peak live)",
      l0!.desktop.fragment.registers,
      l1!.desktop.fragment.registers,
      l2!.desktop.fragment.registers,
    ],
    ...l0!.targets.map((t, i): [string, number, number, number] => [
      `${t.target} statements`,
      t.statements,
      l1!.targets[i]!.statements,
      l2!.targets[i]!.statements,
    ]),
  ];
  return (
    <table className="kk-pro__table" data-kk="opt-report-table">
      <thead>
        <tr>
          <th>Metric</th>
          <th>{LEVEL_NAME[0]}</th>
          <th>{LEVEL_NAME[1]}</th>
          <th>{LEVEL_NAME[2]}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, a, b, c]) => (
          <tr key={label}>
            <td>{label}</td>
            <td>{Math.round(a * 10) / 10}</td>
            <td>
              {Math.round(b * 10) / 10} <span className="kk-pro__muted">{pct(a, b)}</span>
            </td>
            <td>
              {Math.round(c * 10) / 10} <span className="kk-pro__muted">{pct(a, c)}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Rules({ rep }: { rep: OptimizationReport }) {
  const l2 = rep.levels[2]!.rules;
  const l1 = rep.levels[1]!.rules;
  const keys = Object.keys(l2).sort();
  if (keys.length === 0)
    return <div className="kk-pro__muted">The optimiser found nothing to change in this graph.</div>;
  return (
    <div className="kk-pro__chips" data-kk="opt-report-rules">
      {keys.map((k) => (
        <span key={k} className="kk-pro__chip" title={`Level 1: ${l1[k] ?? 0} · Level 2: ${l2[k]}`}>
          {l2[k]} × {k}
          {(l1[k] ?? 0) === 0 ? " (L2 only)" : ""}
        </span>
      ))}
    </div>
  );
}

function CodeDiff({ graphKey }: { graphKey: NonNullable<ReturnType<typeof useShader.getState>["graph"]> }) {
  const [target, setTarget] = useState("glsl");
  const [a, setA] = useState<OptLevel>(0);
  const [b, setB] = useState<OptLevel>(2);
  const lines = useMemo(() => {
    try {
      return diffLines(targetText(graphKey, target as "glsl", a), targetText(graphKey, target as "glsl", b));
    } catch {
      return [];
    }
  }, [graphKey, target, a, b]);
  const st = diffStats(lines);
  const lv = [0, 1, 2].map((l) => ({ value: String(l), label: LEVEL_NAME[l as OptLevel] }));
  const targets = [
    { value: "glsl", label: "GLSL" },
    { value: "hlsl", label: "HLSL" },
    { value: "wgsl", label: "WGSL" },
    ...(graphKey.profileId.startsWith("unity.") ? [{ value: "unity", label: "Unity URP" }] : []),
    ...(graphKey.profileId.startsWith("godot.") ? [{ value: "godot", label: "Godot 4" }] : []),
  ];
  return (
    <div data-kk="opt-report-diff">
      <div className="kk-pro__row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <Select<string> value={target} options={targets} aria-label="Diff target" onChange={setTarget} />
        <Select<string>
          value={String(a)}
          options={lv}
          aria-label="From level"
          onChange={(v) => setA(Number(v) as OptLevel)}
        />
        <Select<string>
          value={String(b)}
          options={lv}
          aria-label="To level"
          onChange={(v) => setB(Number(v) as OptLevel)}
        />
      </div>
      <div className="kk-pro__muted">
        {st.removed} line(s) removed · {st.added} added
      </div>
      <pre className="kk-diff">
        {lines
          .filter((l) => l.kind !== "same" || st.added + st.removed === 0)
          .slice(0, 400)
          .map((l, i) => (
            <div key={i} data-kind={l.kind}>
              {l.kind === "add" ? "+ " : "- "}
              {l.text}
            </div>
          ))}
      </pre>
    </div>
  );
}

/** Optimization report (O1): before / after numbers per level, applied transformations with counts, code diff between levels. */
export function OptReportDialog() {
  const open = useProUi((s) => s.optReportOpen);
  const graph = useShader((s) => s.graph);
  const rep = useMemo(() => (open && graph ? buildOptimizationReport(graph) : undefined), [open, graph]);
  return (
    <Modal
      open={open}
      onClose={() => useProUi.getState().set({ optReportOpen: false })}
      title={`Optimization report${graph ? ` — ${graph.name || "Untitled"}` : ""}`}
      width={720}
      footer={
        <Button variant="primary" onClick={() => useProUi.getState().set({ optReportOpen: false })}>
          Close
        </Button>
      }
    >
      <div className="kk-pro" style={{ padding: 0 }} data-kk="opt-report">
        {!rep || !graph ? (
          <div className="kk-pro__muted">The graph does not compile yet — fix the errors first.</div>
        ) : (
          <>
            <Metrics rep={rep} />
            <h3>Applied transformations (level 2)</h3>
            <Rules rep={rep} />
            <h3>Code diff between levels</h3>
            <CodeDiff graphKey={graph} />
            <div className="kk-pro__muted">
              Cost numbers come from the static model in <code>core/stats/cost.ts</code> (relative weights, not GPU
              timings). Unity / Godot / HLSL text is never compiled here.
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
