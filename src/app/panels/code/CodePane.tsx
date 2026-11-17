import { Check, Copy, Download, Settings2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { type CompileResult, type GeneratedTarget } from "@/core";
import {
  Checkbox,
  CodeView,
  EmptyState,
  IconButton,
  Popover,
  Select,
  Tabs,
  copyToClipboard,
  toast,
  type SelectOption,
} from "@/ui";
import { getActiveDoc, getGraph, setSelection } from "@/ui/graph/graphStore";
import { downloadText } from "../../lib/download";
import { CODE_TARGETS, type CodeTarget } from "../../shaderStore";
import { useGpuCheck } from "../useGpuCheck";
import { type TargetOptions, livePanes, useCode } from "./codeStore";
import { linesForNodes, nodeAtLine } from "./sourceMap";
import { useTargetCheck } from "./useTargetCheck";

const FILE_LABEL: Record<string, string> = { "shader.vert": "Vertex", "shader.frag": "Fragment" };
const TARGET_OPTIONS: SelectOption<CodeTarget>[] = CODE_TARGETS.map((t) => ({
  value: t.id,
  label: t.label,
  disabled: !t.enabled,
  description: t.reason,
}));
const OPTION_LABELS: Array<{ key: keyof TargetOptions; label: string; tip: string }> = [
  {
    key: "flipClipY",
    label: "Flip clip-space Y",
    tip: "Negate clip-space Y at the vertex output (render targets sampled upside down).",
  },
  {
    key: "flipUvV",
    label: "Flip UV V",
    tip: "v' = 1 − v on mesh UVs (textures uploaded top-left with bottom-left mesh UVs).",
  },
  {
    key: "nativeDerivatives",
    label: "Native ddy sign",
    tip: "Keep the API's own ddy / dpdy sign (pixel Y grows downward) instead of the canonical GLSL sign.",
  },
];

interface Props {
  index: number;
  target: CodeTarget;
  file: string;
  result: CompileResult | null;
  hasGraph: boolean;
  graphName: string;
  selection: readonly string[];
  canRemove: boolean;
}

/** One code pane: target selector, file tabs, entry-point jumps, options, copy / download, source-map click-through, diagnostics. */
export function CodePane({ index, target, file: wanted, result, hasGraph, graphName, selection, canRemove }: Props) {
  const { setPaneTarget, setPaneFile, removePane, options, setOption } = useCode();
  const [copied, setCopied] = useState(false);
  const [optsAnchor, setOptsAnchor] = useState<HTMLElement | null>(null);
  const [reveal, setReveal] = useState<number | undefined>(undefined);
  const [showWarn, setShowWarn] = useState(false);

  const files = result?.files ?? [];
  const defaultFile = target === "glsl" ? "shader.frag" : (files[0]?.path ?? "");
  const file = files.find((f) => f.path === wanted) ?? files.find((f) => f.path === defaultFile) ?? files[0];
  livePanes[index] = { target, file: file?.path ?? "", text: file?.content ?? "", result };

  const gpu = useGpuCheck(target === "glsl" ? result : null);
  const check = useTargetCheck(target, result);
  const errors = useMemo(() => (result?.diagnostics ?? []).filter((d) => d.severity === "error"), [result]);
  const warnings = useMemo(() => (result?.diagnostics ?? []).filter((d) => d.severity === "warning"), [result]);
  const highlight = useMemo(() => (file ? linesForNodes(result, file.path, selection) : []), [result, file, selection]);
  const sections = file ? (result?.sections?.[file.path] ?? []) : [];
  const language = target === "glsl" || target === "godot" ? "glsl" : target === "wgsl" ? "wgsl" : "hlsl";
  const generated =
    target === "glsl" || target === "hlsl" || target === "wgsl" || target === "unity" || target === "godot";

  const copy = async () => {
    if (!file) return;
    const ok = await copyToClipboard(file.content);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 1400);
    toast.show(
      ok
        ? { title: `Copied ${FILE_LABEL[file.path] ?? file.path}`, kind: "success", duration: 1800 }
        : { title: "Copy failed", description: "The browser blocked clipboard access.", kind: "danger" },
    );
  };

  const onLine = (line: number) => {
    const hit = file ? nodeAtLine(result, file.path, line) : undefined;
    if (hit && hit.nodeId in getGraph().nodes && getActiveDoc()) setSelection([hit.nodeId]);
  };

  const o = generated && target !== "glsl" ? options[target as GeneratedTarget] : undefined;
  return (
    <section className="kk-codepane" data-kk="code-pane" data-pane={index} data-target={target}>
      <div className="kk-codepanel__bar" data-ctx-scope="code.tab" data-ctx-id={`${index}:${file?.path ?? ""}`}>
        <Select<CodeTarget>
          className="kk-codepanel__target"
          density="compact"
          value={target}
          options={TARGET_OPTIONS}
          onChange={(t) => setPaneTarget(index, t)}
          searchable={false}
          aria-label="Export target"
        />
        <Tabs
          items={files.map((f) => ({ id: f.path, label: FILE_LABEL[f.path] ?? f.path }))}
          value={file?.path ?? ""}
          onChange={(f) => setPaneFile(index, f)}
        />
        {sections.map((s) => (
          <button
            key={s.label}
            type="button"
            className="kk-codepanel__jump"
            data-jump={s.label}
            title={`Jump to the ${s.label.toLowerCase()} entry point`}
            onClick={() => setReveal(s.line + (reveal === s.line ? 0.0001 : 0))}
          >
            {s.label} ▸
          </button>
        ))}
        {o && (
          <IconButton
            icon={Settings2}
            label={`${target.toUpperCase()} options`}
            size="sm"
            active={!!optsAnchor}
            onClick={(e) => setOptsAnchor(optsAnchor ? null : e.currentTarget)}
          />
        )}
        <IconButton icon={copied ? Check : Copy} label="Copy code" size="sm" disabled={!file} onClick={copy} />
        <IconButton
          icon={Download}
          label="Download file"
          size="sm"
          disabled={!file}
          onClick={() => file && downloadText(file.path, file.content)}
        />
        {canRemove && <IconButton icon={X} label="Close pane" size="sm" onClick={() => removePane(index)} />}
      </div>
      {o && (
        <Popover
          open={!!optsAnchor}
          anchor={optsAnchor}
          onClose={() => setOptsAnchor(null)}
          ariaLabel={`${target} options`}
          width={250}
        >
          <div className="kk-codepanel__opts">
            {OPTION_LABELS.map((opt) => (
              <Checkbox
                key={opt.key}
                label={opt.label}
                tooltip={opt.tip}
                checked={o[opt.key]}
                onChange={(v) => setOption(target as GeneratedTarget, opt.key, v)}
              />
            ))}
          </div>
        </Popover>
      )}
      <div className="kk-codepanel__body" data-ctx-scope="code.line" data-ctx-id={String(index)}>
        {!hasGraph ? (
          <EmptyState
            icon={Settings2}
            title="No shader yet"
            description="Open a graph on the canvas or load a sample from Dev → Load sample graph…"
          />
        ) : file ? (
          <CodeView
            value={file.content}
            language={language}
            label={`${FILE_LABEL[file.path] ?? file.path} (${target}, read-only)`}
            onLineClick={onLine}
            highlightLines={highlight}
            revealLine={reveal !== undefined ? Math.round(reveal) : undefined}
          />
        ) : (
          <EmptyState
            icon={Settings2}
            title="No code generated"
            description={errors[0]?.message ?? "Fix the problems in the graph to generate code."}
          />
        )}
      </div>
      {gpu.state === "error" && (
        <div className="kk-codepanel__diag" role="alert" data-testid="gpu-log">
          WebGL2 driver rejected the shader:
          <br />
          {gpu.log}
        </div>
      )}
      {(errors.length > 0 || check.messages.length > 0) && (
        <div className="kk-codepanel__diag" role="alert" data-testid="target-diag">
          {errors.slice(0, 6).map((d, i) => (
            <div
              key={i}
              data-node={d.nodeId ?? ""}
              style={d.nodeId ? { cursor: "pointer" } : undefined}
              onClick={() => d.nodeId && d.nodeId in getGraph().nodes && setSelection([d.nodeId])}
            >
              {d.code}: {d.message}
            </div>
          ))}
          {check.messages.slice(0, 6).map((m, i) => (
            <div key={`c${i}`}>{m}</div>
          ))}
        </div>
      )}
      {showWarn && warnings.length > 0 && (
        <div
          className="kk-codepanel__diag"
          style={{ background: "var(--kk-warning-soft, var(--kk-surface-2))" }}
          data-testid="target-warnings"
        >
          {warnings.slice(0, 8).map((d, i) => (
            <div key={i}>
              {d.code}: {d.message}
            </div>
          ))}
        </div>
      )}
      <div className="kk-codepanel__foot">
        <span>{hasGraph ? graphName || "Untitled graph" : "No graph"}</span>
        {file && <span>· {file.content.split("\n").length} lines</span>}
        {result && (
          <span className={errors.length ? "is-error" : "is-ok"}>
            · {errors.length ? `${errors.length} error(s)` : "OK"}
          </span>
        )}
        {gpu.state === "ok" && (
          <span className="is-ok" title="Compiled and linked by this browser's WebGL2 driver">
            · compiles on this GPU
          </span>
        )}
        {gpu.state === "error" && <span className="is-error">· GPU compile failed</span>}
        {gpu.state === "unavailable" && (
          <span title="No WebGL2 context is available in this browser">· GPU check unavailable</span>
        )}
        {(check.state === "ok" || check.state === "static-ok") && (
          <span
            className="is-ok"
            data-check={check.state}
            title={
              check.state === "static-ok"
                ? "HLSL cannot be compiled in a browser: only static checks ran"
                : "Validated by a real WGSL front-end"
            }
          >
            · {check.label}
          </span>
        )}
        {(check.state === "error" || check.state === "static-error") && (
          <span className="is-error" data-check={check.state}>
            · {check.label}
          </span>
        )}
        {check.state === "pending" && <span>· {check.label}</span>}
        {warnings.length > 0 && (
          <span
            className="is-warn"
            role="button"
            tabIndex={0}
            style={{ cursor: "pointer" }}
            onClick={() => setShowWarn(!showWarn)}
          >
            · {warnings.length} warning(s)
          </span>
        )}
        {result && <span style={{ marginLeft: "auto" }}>{result.timings.total.toFixed(1)} ms</span>}
      </div>
    </section>
  );
}
