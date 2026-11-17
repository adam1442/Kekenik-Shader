import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { PortValue, ShaderType, SubgraphPort } from "@/core";
import { ColorField, IconButton, IntField, NumberField, Select, TextField, Toggle, VecField } from "@/ui";
import { addSubgraphPort, moveSubgraphPort, patchSubgraphPort, removeSubgraphPort } from "./subgraphActions";
import { useGraphs } from "./graphStore";
import { toComponents } from "./NodeEditors";

const TYPES: ShaderType[] = ["float", "int", "bool", "vec2", "vec3", "vec4", "color", "color4", "texture2D"];
const OPTIONS = TYPES.map((t) => ({ value: t, label: t }));
const DIM: Partial<Record<ShaderType, number>> = { vec2: 2, vec3: 3, vec4: 4, color: 3, color4: 4 };

/** Editor of the default value of a subgraph input. */
function DefaultEditor({ port, onChange }: { port: SubgraphPort; onChange: (v: PortValue) => void }) {
  const t = port.type;
  const dim = DIM[t] ?? 0;
  const comps = toComponents(port.default, dim || 1, t === "color4" ? 1 : 0);
  if (t === "float")
    return (
      <NumberField
        density="compact"
        step={0.01}
        aria-label="Default"
        value={typeof port.default === "number" ? port.default : 0}
        onChange={() => undefined}
        onCommit={onChange}
      />
    );
  if (t === "int")
    return (
      <IntField
        density="compact"
        aria-label="Default"
        value={typeof port.default === "number" ? port.default : 0}
        onChange={() => undefined}
        onCommit={onChange}
      />
    );
  if (t === "bool")
    return <Toggle density="compact" aria-label="Default" checked={!!port.default} onChange={onChange} />;
  if (t === "color" || t === "color4")
    return (
      <ColorField
        density="compact"
        alpha={t === "color4"}
        aria-label="Default"
        value={{ r: comps[0] ?? 0, g: comps[1] ?? 0, b: comps[2] ?? 0, a: comps[3] ?? 1 }}
        onChange={() => undefined}
        onCommit={(c) => onChange(t === "color4" ? [c.r, c.g, c.b, c.a] : [c.r, c.g, c.b])}
      />
    );
  if (dim)
    return (
      <VecField
        density="compact"
        dim={dim as 2 | 3 | 4}
        step={0.01}
        aria-label="Default"
        value={comps}
        onChange={() => undefined}
        onCommit={onChange}
      />
    );
  return <span className="kk-sgio__none">no default</span>;
}

interface RowProps {
  defId: string;
  kind: "input" | "output";
  port: SubgraphPort;
  index: number;
  count: number;
}

function PortRow({ defId, kind, port, index, count }: RowProps) {
  const patch = (p: Parameters<typeof patchSubgraphPort>[3]) => patchSubgraphPort(defId, kind, port.id, p);
  return (
    <div className="kk-sgio__row" data-testid="sgio-row" data-port-id={port.id} data-kind={kind}>
      <div className="kk-sgio__line">
        <TextField
          density="compact"
          aria-label={`${kind} name`}
          value={port.name}
          onChange={() => undefined}
          onCommit={(v) => v.trim() && patch({ name: v.trim() })}
        />
        <Select
          density="compact"
          aria-label={`${kind} type`}
          value={port.type}
          options={OPTIONS}
          onChange={(t) => patch({ type: t })}
        />
        <IconButton
          icon={ArrowUp}
          size="sm"
          label="Move up"
          disabled={index === 0}
          onClick={() => moveSubgraphPort(defId, kind, port.id, index - 1)}
        />
        <IconButton
          icon={ArrowDown}
          size="sm"
          label="Move down"
          disabled={index === count - 1}
          onClick={() => moveSubgraphPort(defId, kind, port.id, index + 1)}
        />
        <IconButton
          icon={Trash2}
          size="sm"
          label={`Remove ${kind}`}
          onClick={() => removeSubgraphPort(defId, kind, port.id)}
        />
      </div>
      <div className="kk-sgio__line kk-sgio__line--sub">
        {kind === "input" && <DefaultEditor port={port} onChange={(v) => patch({ default: v })} />}
        {kind === "input" && (
          <label
            className="kk-sgio__opt"
            title="An optional input may stay unconnected: the instance then uses the default"
          >
            <Toggle
              density="compact"
              aria-label="Optional"
              checked={!!port.optional}
              onChange={(b) => patch({ optional: b })}
            />{" "}
            optional
          </label>
        )}
        <TextField
          density="compact"
          aria-label="Tooltip"
          placeholder="Tooltip"
          value={port.tooltip ?? ""}
          onChange={() => undefined}
          onCommit={(v) => patch({ tooltip: v })}
        />
      </div>
    </div>
  );
}

/** Inputs / outputs of a subgraph: add, remove, rename, reorder, type, default, tooltip, optional. Edits update every instance. */
export function SubgraphIoEditor({ defId }: { defId: string }) {
  const def = useGraphs((s) => {
    const d = s.docs.find((x) => x.id === s.activeId);
    return d?.graph.subgraphDefs[defId];
  });
  if (!def) return null;
  const section = (kind: "input" | "output", list: SubgraphPort[]) => (
    <div className="kk-sgio__section" data-testid={`sgio-${kind}s`}>
      <div className="kk-sgio__head">
        <span>{kind === "input" ? "Inputs" : "Outputs"}</span>
        <IconButton icon={Plus} size="sm" label={`Add ${kind}`} onClick={() => addSubgraphPort(defId, kind)} />
      </div>
      {list.length === 0 && <div className="kk-sgio__none">No {kind}s</div>}
      {list.map((p, i) => (
        <PortRow key={p.id} defId={defId} kind={kind} port={p} index={i} count={list.length} />
      ))}
    </div>
  );
  return (
    <div className="kk-sgio" data-testid="subgraph-io" data-def={defId}>
      {section("input", def.inputs)}
      {section("output", def.outputs)}
    </div>
  );
}
