import { useEffect, useState } from "react";
import { FileDown, PackagePlus, X } from "lucide-react";
import { type BudgetRow, type SampleIndexEntry, parseKShader, sampleBudget } from "@/core";
import { Badge, Button, IconButton, Select } from "@/ui";
import { insertSampleSubgraph, openSampleAsProject } from "./actions";
import { sampleText } from "./source";

const TARGET_LABEL: Record<string, string> = { glsl: "GLSL", hlsl: "HLSL", wgsl: "WGSL", unity: "Unity URP", godot: "Godot 4" };

/** Estimated cost of the sample against its declared budget class (10d model); computed from the sample file on demand. */
function useBudget(entry: SampleIndexEntry): BudgetRow[] | null | "error" {
  const [rows, setRows] = useState<BudgetRow[] | null | "error">(null);
  useEffect(() => {
    let alive = true;
    setRows(null);
    sampleText(entry.file).then((t) => { if (alive) setRows(sampleBudget(parseKShader(t).graph, entry.budgetClass).rows); }, () => { if (alive) setRows("error"); });
    return () => { alive = false; };
  }, [entry]);
  return rows;
}

/** Details drawer: description, compatibility, parameters, cost vs budget and the two "use it" actions. */
export function SampleDetails({ entry, onClose }: { entry: SampleIndexEntry; onClose: () => void }) {
  const budget = useBudget(entry);
  const reusable = entry.reusableSubgraphs ?? [];
  const [sub, setSub] = useState(reusable[0] ?? "");
  useEffect(() => setSub(reusable[0] ?? ""), [entry]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <aside className="kk-smp__drawer" data-kk="sample-details" data-sample={entry.id}>
      <header><h3>{entry.title}</h3><IconButton icon={X} label="Close details" size="sm" onClick={onClose} /></header>
      <p>{entry.description}</p>
      <div className="kk-smp__meta">
        <Badge>{entry.category}</Badge><Badge>{entry.difficulty}</Badge><Badge>{entry.budgetClass}</Badge>
        {entry.targets.map((t) => <Badge key={t}>{TARGET_LABEL[t] ?? t}</Badge>)}
      </div>
      <div className="kk-smp__actions">
        <Button variant="primary" icon={FileDown} data-action="open" onClick={() => void openSampleAsProject(entry)}>Open as new project</Button>
        <Select value={sub} options={reusable.length ? reusable.map((r) => ({ value: r, label: r })) : [{ value: "", label: "No reusable subgraph" }]} onChange={setSub} disabled={!reusable.length} density="compact" />
        <Button icon={PackagePlus} data-action="insert" disabled={!sub} onClick={() => void insertSampleSubgraph(entry, sub)}>Insert as subgraph</Button>
      </div>
      {entry.requiredFeatures.length > 0 && <><h4>Requires</h4><ul>{entry.requiredFeatures.map((f) => <li key={f}>{f}</li>)}</ul></>}
      {entry.compatNotes.length > 0 && <><h4>Compatibility notes</h4><ul>{entry.compatNotes.map((f) => <li key={f}>{f}</li>)}</ul></>}
      <h4>Estimated cost vs {entry.budgetClass} budget</h4>
      {budget === null ? <div className="kk-smp__muted">Estimating…</div> : budget === "error" ? <div className="kk-smp__muted">Not available</div> : (
        <table className="kk-pro__table" data-kk="sample-budget"><tbody>{budget.map((r) => <tr key={r.label} data-status={r.status}><td>{r.label}</td><td>{r.value}</td><td>≤ {r.limit}</td></tr>)}</tbody></table>
      )}
      <h4>Parameters ({entry.parameters.length})</h4>
      <table className="kk-pro__table" data-kk="sample-params"><tbody>
        {entry.parameters.map((p) => <tr key={p.id} title={p.tooltip}><td>{p.name}{p.hdr ? " (HDR)" : ""}</td><td>{p.type}</td><td>{p.min !== undefined ? `${p.min} … ${p.max}` : p.texture ?? ""}</td></tr>)}
      </tbody></table>
      <h4>Content</h4>
      <div className="kk-smp__muted">{entry.nodes} nodes · {entry.groups} groups · {entry.comments} notes · {entry.subgraphs.length} subgraphs{entry.textures.length ? ` · ${entry.textures.join(", ")}` : ""}</div>
    </aside>
  );
}
