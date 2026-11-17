import { useMemo, useState } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { defaultNodeRegistry } from "@/core";
import {
  Button,
  IconButton,
  Modal,
  ScrollArea,
  SegmentedControl,
  Select,
  ShortcutRecorder,
  Slider,
  TextField,
  Toggle,
  normalizeShortcut,
} from "@/ui";
import { findKeybindingConflicts, getDefaultCommand, listCommands } from "../commands/registry";
import { type PreferenceValues, DEFAULT_QUICK_NODES, usePrefs } from "../prefs/preferences";
import { useProUi } from "./proState";
import { quickNodeConflicts } from "./quickNodes";

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="kk-pro__row">
    <label>{label}</label>
    <div>{children}</div>
  </div>
);

/** Conflict message of a candidate shortcut for command `id` (shared with the tests). */
function shortcutConflict(id: string, shortcut: string, overrides: Record<string, string>): string | null {
  const next = listCommands().map((c) =>
    c.id === id ? { ...c, shortcut } : { ...c, shortcut: overrides[c.id] ?? c.shortcut },
  );
  const hit = findKeybindingConflicts(next).find(
    (g) => g.commandIds.includes(id) && g.shortcut === normalizeShortcut(shortcut),
  );
  return hit ? `Already used by ${hit.commandIds.filter((x) => x !== id).join(", ")}` : null;
}

function Keybindings() {
  const p = usePrefs();
  const [q, setQ] = useState("");
  const cmds = useMemo(
    () =>
      listCommands().filter(
        (c) =>
          c.run &&
          (getDefaultCommand(c.id)?.shortcut || p.keybindings[c.id] !== undefined || c.shortcut) &&
          (c.title + c.id).toLowerCase().includes(q.toLowerCase()),
      ),
    [q, p.keybindings],
  );
  return (
    <>
      <TextField value={q} placeholder="Filter commands…" onChange={setQ} aria-label="Filter commands" clearable />
      <ScrollArea style={{ maxHeight: 220 }}>
        {cmds.map((c) => (
          <div key={c.id} className="kk-pro__row" style={{ gridTemplateColumns: "1fr 150px 24px" }}>
            <label title={c.id}>{c.title}</label>
            <ShortcutRecorder
              value={c.shortcut ?? ""}
              aria-label={`Shortcut of ${c.title}`}
              conflict={(s) => shortcutConflict(c.id, s, p.keybindings)}
              onChange={() => undefined}
              onCommit={(s) => p.set({ keybindings: { ...p.keybindings, [c.id]: s } })}
            />
            <IconButton
              icon={RotateCcw}
              size="sm"
              label="Reset to default"
              disabled={p.keybindings[c.id] === undefined}
              onClick={() => {
                const { [c.id]: _x, ...rest } = p.keybindings;
                void _x;
                p.set({ keybindings: rest });
              }}
            />
          </div>
        ))}
      </ScrollArea>
    </>
  );
}

function QuickNodes() {
  const p = usePrefs();
  const [key, setKey] = useState("");
  const [def, setDef] = useState("float");
  const options = useMemo(
    () =>
      defaultNodeRegistry
        .list()
        .filter((d) => !d.structural)
        .map((d) => ({ value: d.id, label: d.name, group: d.category })),
    [],
  );
  const conflicts = quickNodeConflicts(p.quickNodes);
  return (
    <>
      {Object.entries(p.quickNodes)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, id]) => (
          <div key={k} className="kk-pro__row" style={{ gridTemplateColumns: "40px 1fr 24px" }}>
            <kbd className="kk-kbd">{k.toUpperCase()}</kbd>
            <span>
              {defaultNodeRegistry.get(id)?.name ?? id}
              {conflicts.some((c) => c.key === k) && (
                <span className="kk-pro__warn"> — clashes with a command shortcut</span>
              )}
            </span>
            <IconButton
              icon={Trash2}
              size="sm"
              label="Remove"
              onClick={() => {
                const { [k]: _x, ...rest } = p.quickNodes;
                void _x;
                p.set({ quickNodes: rest });
              }}
            />
          </div>
        ))}
      <div className="kk-pro__row" style={{ gridTemplateColumns: "60px 1fr 90px" }}>
        <TextField value={key} maxLength={1} placeholder="Key" aria-label="New quick-node key" onChange={setKey} />
        <Select<string> value={def} options={options} aria-label="Node" onChange={setDef} />
        <Button
          size="sm"
          icon={Plus}
          disabled={key.length !== 1 || key === " "}
          onClick={() => {
            p.set({ quickNodes: { ...p.quickNodes, [key.toLowerCase()]: def } });
            setKey("");
          }}
        >
          Add
        </Button>
      </div>
      <Button size="sm" icon={RotateCcw} onClick={() => p.set({ quickNodes: { ...DEFAULT_QUICK_NODES } })}>
        Restore default keys
      </Button>
    </>
  );
}

type Tab = "general" | "keys" | "quick";

export function PreferencesDialog() {
  const open = useProUi((s) => s.prefsOpen);
  const close = () => useProUi.getState().set({ prefsOpen: false });
  const p = usePrefs();
  const [tab, setTab] = useState<Tab>("general");
  const seg = <K extends keyof PreferenceValues>(
    k: K,
    options: Array<{ value: PreferenceValues[K] & string; label: string }>,
  ) => (
    <SegmentedControl<PreferenceValues[K] & string>
      value={p[k] as PreferenceValues[K] & string}
      options={options}
      block
      aria-label={String(k)}
      onChange={(v) => p.set({ [k]: v } as Partial<PreferenceValues>)}
    />
  );
  return (
    <Modal
      open={open}
      onClose={close}
      title="Preferences"
      width={620}
      footer={
        <>
          <Button onClick={() => p.reset()} icon={RotateCcw}>
            Reset all
          </Button>
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        </>
      }
    >
      <div className="kk-pro" style={{ padding: 0 }}>
        <SegmentedControl<Tab>
          value={tab}
          block
          aria-label="Preferences section"
          options={[
            { value: "general", label: "General" },
            { value: "keys", label: "Keybindings" },
            { value: "quick", label: "Quick nodes" },
          ]}
          onChange={setTab}
        />
        {tab === "general" && (
          <>
            <Row label="Theme">
              {seg("theme", [
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
              ])}
            </Row>
            <Row label="UI scale">
              <Slider
                value={p.uiScale}
                min={0.8}
                max={1.4}
                step={0.05}
                precision={2}
                aria-label="UI scale"
                onChange={() => undefined}
                onCommit={(v) => p.set({ uiScale: v })}
              />
            </Row>
            <Row label="Grid style">
              {seg("gridStyle", [
                { value: "dots", label: "Dots" },
                { value: "lines", label: "Lines" },
                { value: "cross", label: "Crosses" },
              ])}
            </Row>
            <Row label="Wire style">
              {seg("wireStyle", [
                { value: "bezier", label: "Bezier" },
                { value: "orthogonal", label: "Stepped" },
                { value: "straight", label: "Straight" },
              ])}
            </Row>
            <Row label="Autosave (seconds, 0 = off)">
              <Slider
                value={p.autosaveSec}
                min={0}
                max={300}
                step={5}
                precision={0}
                aria-label="Autosave interval"
                onChange={() => undefined}
                onCommit={(v) => p.set({ autosaveSec: v })}
              />
            </Row>
            <Row label="Preview quality">
              {seg("previewQuality", [
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
              ])}
            </Row>
            <Row label="Embed textures in saved projects">
              <Toggle
                checked={p.embedAssets}
                aria-label="Embed textures in saved projects"
                onChange={(v) => p.set({ embedAssets: v })}
              />
            </Row>
            <Row label="Optimisation">
              <SegmentedControl<"0" | "1" | "2">
                value={String(p.optLevel) as "0" | "1" | "2"}
                block
                aria-label="Optimisation level"
                options={[
                  { value: "0", label: "Off" },
                  { value: "1", label: "Safe (L1)" },
                  { value: "2", label: "Fast-math (L2)" },
                ]}
                onChange={(v) => p.set({ optLevel: Number(v) as 0 | 1 | 2 })}
              />
            </Row>
            <Row label="Vertex hoisting">
              {seg("hoist", [
                { value: "off", label: "Off" },
                { value: "conservative", label: "Conservative" },
                { value: "aggressive", label: "Aggressive" },
              ])}
            </Row>
            <div className="kk-pro__muted">
              Moves per-pixel expressions that are AFFINE in the interpolated inputs (UV × tiling + offset,
              vertex-colour tints …) to the vertex stage — identical image, less fragment work. Conservative keeps the
              interpolator count (≤ 6, +1 at most); Aggressive allows up to 8. Never applied to normalize / sin / pow /
              UV × UV, derivatives or texture reads. Very dense meshes can lose more per vertex than they gain per
              pixel.
            </div>
            <div className="kk-pro__muted">
              L1 = constant folding, exact algebraic identities, CSE, dead-code removal. L2 additionally allows x·0 → 0,
              x−x → 0, pow(x,2) → x·x (results may differ for NaN / Inf / negative bases). Applies to the preview and
              every export.
            </div>
          </>
        )}
        {tab === "keys" && <Keybindings />}
        {tab === "quick" && <QuickNodes />}
      </div>
    </Modal>
  );
}
