import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  CUSTOM_FN_PARAM,
  CUSTOM_TARGETS,
  CUSTOM_TARGET_LABEL,
  type CustomFnSpec,
  type CustomPort,
  type CustomTarget,
  type NodeInstance,
  type ShaderType,
  FILE_TARGETS,
  bodyFor,
  includeFor,
  parseSpec,
  serializeSpec,
  validateSpec,
} from "@/core";
import { Button, CodeView, IconButton, SegmentedControl, Select, TextField, Toggle } from "@/ui";
import { setParam } from "../actions";

const TYPES: ShaderType[] = ["float", "int", "bool", "vec2", "vec3", "vec4", "mat3", "mat4", "texture2D"];
const LANG: Record<CustomTarget, "glsl" | "hlsl" | "wgsl"> = {
  glsl: "glsl",
  godot: "glsl",
  hlsl: "hlsl",
  unity: "hlsl",
  wgsl: "wgsl",
};

function PortList({
  title,
  ports,
  onChange,
  noOpaque,
}: {
  title: string;
  ports: CustomPort[];
  onChange: (p: CustomPort[]) => void;
  noOpaque?: boolean;
}) {
  const types = (noOpaque ? TYPES.filter((t) => t !== "texture2D") : TYPES).map((t) => ({ value: t, label: t }));
  return (
    <div className="kk-insp__sec">
      <h4>{title}</h4>
      {ports.map((p, i) => (
        <div key={i} className="kk-pro__row" style={{ gridTemplateColumns: "1fr 96px 24px" }}>
          <TextField
            value={p.name}
            mono
            aria-label={`${title} ${i + 1} name`}
            onChange={() => undefined}
            onCommit={(v) => onChange(ports.map((q, k) => (k === i ? { ...q, name: v } : q)))}
          />
          <Select<string>
            value={p.type}
            options={types}
            aria-label={`${title} ${i + 1} type`}
            onChange={(v) => onChange(ports.map((q, k) => (k === i ? { ...q, type: v as ShaderType } : q)))}
          />
          <IconButton
            icon={Trash2}
            size="sm"
            label="Remove"
            onClick={() => onChange(ports.filter((_, k) => k !== i))}
          />
        </div>
      ))}
      <Button
        size="sm"
        icon={Plus}
        onClick={() =>
          onChange([...ports, { name: `${title === "Inputs" ? "In" : "Out"}${ports.length + 1}`, type: "float" }])
        }
      >
        Add
      </Button>
    </div>
  );
}

/** Inspector editor of a Custom Function node: typed ports, one CodeMirror body per target, family-sharing toggles, missing-body diagnostics. */
export function CustomFunctionEditor({ node }: { node: NodeInstance }) {
  const stored = parseSpec(node.params[CUSTOM_FN_PARAM]);
  const [draft, setDraft] = useState<CustomFnSpec>(stored);
  const [target, setTarget] = useState<CustomTarget>("glsl");
  const timer = useRef<number | undefined>(undefined);
  const key = String(node.params[CUSTOM_FN_PARAM] ?? "");
  useEffect(() => setDraft(parseSpec(key)), [node.id, key]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const push = (s: CustomFnSpec, now = true) => {
    setDraft(s);
    window.clearTimeout(timer.current);
    const go = () => setParam(node.id, CUSTOM_FN_PARAM, serializeSpec(s));
    if (now) go();
    else timer.current = window.setTimeout(go, 450); // typing: one graph operation per pause, not per keystroke
  };
  const shared = (target === "godot" && draft.sharedGlsl) || (target === "unity" && draft.sharedHlsl);
  const fileMode = draft.mode === "file";
  const missing = CUSTOM_TARGETS.filter(
    (t) => !(bodyFor(draft, t) ?? "").trim() || (fileMode && !includeFor(draft, t)),
  );
  const errs = validateSpec(draft);
  return (
    <>
      <div className="kk-insp__sec">
        <h4>Function</h4>
        <TextField
          value={draft.name}
          aria-label="Function name"
          onChange={() => undefined}
          onCommit={(v) => push({ ...draft, name: v })}
        />
      </div>
      <PortList title="Inputs" ports={draft.inputs} onChange={(inputs) => push({ ...draft, inputs })} />
      <PortList title="Outputs" ports={draft.outputs} onChange={(outputs) => push({ ...draft, outputs })} noOpaque />
      <div className="kk-insp__sec">
        <h4>Source</h4>
        <SegmentedControl<CustomFnSpec["mode"]>
          value={draft.mode}
          block
          aria-label="Source mode"
          options={[
            { value: "inline", label: "Inline code" },
            { value: "file", label: "File reference" },
          ]}
          onChange={(mode) => push({ ...draft, mode })}
        />
      </div>
      <div className="kk-insp__sec">
        <h4>
          {fileMode ? "File" : "Body"} ({CUSTOM_TARGET_LABEL[target]})
        </h4>
        <SegmentedControl<CustomTarget>
          value={target}
          block
          aria-label="Target"
          options={CUSTOM_TARGETS.map((t) => ({
            value: t,
            label: t === "unity" ? "Unity" : t === "godot" ? "Godot" : t.toUpperCase(),
          }))}
          onChange={setTarget}
        />
        {fileMode &&
          (FILE_TARGETS.includes(target) ? (
            <>
              <TextField
                value={(target === "unity" && draft.sharedHlsl ? draft.files.hlsl : draft.files[target]) ?? ""}
                disabled={target === "unity" && draft.sharedHlsl}
                aria-label={`${target} include path`}
                placeholder={
                  target === "godot" ? "res://shaders/my_function.gdshaderinc" : "Assets/Shaders/MyFunction.hlsl"
                }
                onChange={() => undefined}
                onCommit={(v) => push({ ...draft, files: { ...draft.files, [target]: v } })}
              />
              <div className="kk-pro__muted" style={{ marginTop: 4 }}>
                The generated shader gets <code>#include "path"</code> and calls{" "}
                <code>
                  {draft.name}({[...draft.inputs, ...draft.outputs].map((p) => p.name).join(", ")});
                </code>{" "}
                — declare it there with the outputs as <code>out</code> parameters. Kekenik Shader never reads or checks
                the file.
              </div>
            </>
          ) : (
            <div className="kk-pro__warn">
              {CUSTOM_TARGET_LABEL[target]} has no #include — switch to Inline code for this target.
            </div>
          ))}
        {!fileMode && (
          <div className="kk-pro__code" style={{ marginTop: 6 }}>
            <CodeView
              value={
                shared
                  ? ((target === "godot" ? draft.bodies.glsl : draft.bodies.hlsl) ?? "")
                  : (draft.bodies[target] ?? "")
              }
              language={LANG[target]}
              readOnly={shared}
              label={`${target} body`}
              onChange={(v) => push({ ...draft, bodies: { ...draft.bodies, [target]: v } }, false)}
            />
          </div>
        )}
        <div className="kk-pro__muted" style={{ marginTop: 4 }}>
          {fileMode
            ? null
            : shared
              ? `Shared: this target reuses the ${target === "godot" ? "GLSL" : "HLSL"} body.`
              : "Read inputs by name; assign every output by name. The body is never translated between languages."}
        </div>
        <label className="kk-pro__kbd">
          <Toggle
            checked={draft.sharedGlsl}
            aria-label="Godot uses the GLSL body"
            onChange={(v) => push({ ...draft, sharedGlsl: v })}
          />{" "}
          Godot uses the GLSL body
        </label>
        <label className="kk-pro__kbd">
          <Toggle
            checked={draft.sharedHlsl}
            aria-label="Unity uses the HLSL body"
            onChange={(v) => push({ ...draft, sharedHlsl: v })}
          />{" "}
          Unity uses the HLSL body
        </label>
        {missing.length > 0 && (
          <div className="kk-pro__warn">
            Missing body: {missing.map((t) => CUSTOM_TARGET_LABEL[t]).join(", ")} — exporting to these targets reports
            an error on this node.
          </div>
        )}
        {errs.map((e, i) => (
          <div key={i} className="kk-pro__warn">
            {e}
          </div>
        ))}
        <div className="kk-pro__muted">Renaming or removing a port drops its wire. </div>
      </div>
    </>
  );
}
