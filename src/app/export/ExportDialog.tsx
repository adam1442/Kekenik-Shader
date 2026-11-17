import { AlertTriangle, Check, ClipboardCopy, Copy, FileCode2, FileJson, FileText, Package } from "lucide-react";
import { useMemo } from "react";
import {
  BUNDLE_TARGET_IDS,
  type BundleFile,
  type BundleTargetId,
  GODOT_RENDERERS,
  GODOT_VERSIONS,
  UNITY_VERSIONS,
  buildBundle,
  targetProfiles,
} from "@/core";
import { Badge, Button, Checkbox, CodeView, Modal, Select, type SelectOption } from "@/ui";
import { APP_VERSION } from "../lib/version";
import { baseName, copyAll, copyFile, exportZip } from "./actions";
import { selectionOf, useExport } from "./exportStore";
import "../../styles/export.css";

const LABEL: Record<BundleTargetId, string> = {
  unity: "Unity URP",
  godot: "Godot 4",
  glsl: "GLSL (WebGL2)",
  hlsl: "HLSL",
  wgsl: "WGSL (WebGPU)",
};
const EMIT_FLAGS: Array<{ key: "flipClipY" | "flipUvV" | "nativeDerivatives"; label: string; tip: string }> = [
  { key: "flipClipY", label: "Flip clip-space Y", tip: "Negate clip-space Y at the vertex output." },
  { key: "flipUvV", label: "Flip UV V", tip: "v' = 1 − v on mesh UVs." },
  {
    key: "nativeDerivatives",
    label: "Native ddy sign",
    tip: "Keep the API's own ddy sign instead of the canonical GLSL one.",
  },
];
const iconFor = (f: BundleFile) =>
  f.language === "json" ? FileJson : f.language === "markdown" || f.language === "text" ? FileText : FileCode2;
const profileOptions = (engine: "unity-urp" | "godot"): SelectOption<string>[] =>
  targetProfiles.list(engine).map((p) => ({ value: p.id, label: p.label }));
const versions = (id: BundleTargetId): SelectOption<string>[] =>
  (id === "unity" ? UNITY_VERSIONS : GODOT_VERSIONS).map((v) => ({ value: v.id, label: v.label }));

/** Export… dialog: choose targets + options, preview every generated file, copy, or export a deterministic zip. Built only with `src/ui` controls. */
export function ExportDialog() {
  const { open, graph, choices, activePath, confirming, close, setChoice, setActive, setConfirming } = useExport();
  const bundle = useMemo(
    () => (open && graph ? buildBundle(graph, selectionOf(choices), { generatorVersion: APP_VERSION }) : null),
    [open, graph, choices],
  );
  if (!open || !graph || !bundle) return null;
  const selected = BUNDLE_TARGET_IDS.filter((id) => choices[id].enabled);
  const shaderFiles = bundle.files.filter((f) => f.target !== "meta");
  const active = bundle.files.find((f) => f.path === activePath) ?? shaderFiles[0] ?? bundle.files[0];
  const failing = bundle.reports.filter((r) => !r.ok);
  const onZip = () => {
    if (failing.length && !confirming) return setConfirming(true);
    void exportZip(bundle, graph);
    setConfirming(false);
  };
  return (
    <Modal
      open
      onClose={close}
      title="Export Shader"
      width={1040}
      footer={
        <>
          {confirming ? (
            <span className="kk-export__confirm" role="alert">
              <AlertTriangle size={14} /> {failing.map((r) => LABEL[r.id]).join(", ")} failed validation. Export anyway?
            </span>
          ) : (
            <span className="kk-spacer" />
          )}
          <Button
            variant="ghost"
            icon={ClipboardCopy}
            disabled={selected.length === 0}
            onClick={() => void copyAll(bundle)}
            data-action="export-copy-all"
          >
            Copy all
          </Button>
          <Button
            variant={confirming ? "danger" : "primary"}
            icon={Package}
            disabled={selected.length === 0}
            onClick={onZip}
            data-action="export-zip"
          >
            {confirming ? "Export anyway" : "Export zip"}
          </Button>
        </>
      }
    >
      <div className="kk-export" data-kk="export-dialog">
        <div className="kk-export__side">
          <div className="kk-export__targets">
            {BUNDLE_TARGET_IDS.map((id) => {
              const c = choices[id];
              const rep = bundle.reports.find((r) => r.id === id);
              return (
                <div key={id} className="kk-export__target" data-target={id}>
                  <div className="kk-export__row">
                    <Checkbox
                      label={LABEL[id]}
                      checked={c.enabled}
                      onChange={(v) => setChoice(id, { enabled: v })}
                      aria-label={`Export ${LABEL[id]}`}
                    />
                    {rep ? (
                      rep.ok ? (
                        <Badge>
                          <Check size={11} /> {rep.warnings ? `${rep.warnings} warn` : "ok"}
                        </Badge>
                      ) : (
                        <Badge tone="danger">
                          <AlertTriangle size={11} /> {rep.errors} error{rep.errors === 1 ? "" : "s"}
                        </Badge>
                      )
                    ) : null}
                  </div>
                  {c.enabled && (id === "unity" || id === "godot") ? (
                    <div className="kk-export__opts">
                      <Select<string>
                        density="compact"
                        searchable={false}
                        aria-label={`${LABEL[id]} profile`}
                        value={c.profile ?? ""}
                        options={profileOptions(id === "unity" ? "unity-urp" : "godot")}
                        onChange={(v) => setChoice(id, { profile: v })}
                      />
                      <Select<string>
                        density="compact"
                        searchable={false}
                        aria-label={`${LABEL[id]} version`}
                        value={c.version ?? ""}
                        options={versions(id)}
                        onChange={(v) => setChoice(id, { version: v })}
                      />
                      {id === "godot" ? (
                        <Select<string>
                          density="compact"
                          searchable={false}
                          aria-label="Godot renderer"
                          value={c.renderer ?? "all"}
                          options={GODOT_RENDERERS.map((r) => ({ value: r.id, label: r.label }))}
                          onChange={(v) => setChoice(id, { renderer: v })}
                        />
                      ) : null}
                    </div>
                  ) : null}
                  {c.enabled && (id === "hlsl" || id === "wgsl") ? (
                    <div className="kk-export__opts" data-kk={`${id}-emit-options`}>
                      {EMIT_FLAGS.map((f) => (
                        <Checkbox
                          key={f.key}
                          label={f.label}
                          tooltip={f.tip}
                          checked={!!c.emit?.[f.key]}
                          onChange={(v) => setChoice(id, { emit: { ...c.emit, [f.key]: v } })}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="kk-export__files" role="listbox" aria-label="Generated files">
            {bundle.files.map((f) => {
              const Icon = iconFor(f);
              return (
                <button
                  key={f.path}
                  type="button"
                  role="option"
                  aria-selected={f.path === active?.path}
                  className={`kk-export__file${f.path === active?.path ? " is-active" : ""}`}
                  data-ctx-scope="export.file"
                  data-ctx-id={f.path}
                  data-path={f.path}
                  onClick={() => setActive(f.path)}
                  title={f.path}
                >
                  <Icon size={13} /> <span>{baseName(f.path)}</span>{" "}
                  <small>{f.path.includes("/") ? f.path.split("/")[0] : ""}</small>
                </button>
              );
            })}
          </div>
        </div>
        <div className="kk-export__preview">
          <div className="kk-export__bar">
            <span className="kk-export__path">{active ? `${bundle.root}/${active.path}` : "No file"}</span>
            {active ? (
              <Button
                size="sm"
                variant="ghost"
                icon={Copy}
                onClick={() => void copyFile(active)}
                data-action="export-copy-file"
              >
                Copy
              </Button>
            ) : null}
          </div>
          {active ? (
            <CodeView
              value={active.content}
              language={
                active.language === "json" || active.language === "markdown" || active.language === "text"
                  ? "plain"
                  : active.language === "hlsl"
                    ? "hlsl"
                    : active.language === "wgsl"
                      ? "wgsl"
                      : "glsl"
              }
              readOnly
              label={`Preview of ${active.path}`}
              className="kk-export__code"
            />
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
