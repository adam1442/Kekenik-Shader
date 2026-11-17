import { Badge, Checkbox, Select, type SelectOption } from "@/ui";
import {
  type Graph,
  type SurfaceOptionDef,
  GODOT_RENDERERS,
  GODOT_VERSIONS,
  UNITY_VERSIONS,
  isSince,
  normalizeRenderer,
  normalizeVersion,
  defaultShaderName,
  exposeKey,
  predicateHolds,
  profileOf,
  sanitizeShaderName,
  targetProfiles,
} from "@/core";
import { switchTargetProfile } from "../actions";
import { setGraphSetting } from "@/ui/graph/actions";
import { CommitNumber, CommitText, Field, Section } from "./fields";

const set = (key: string, value: Parameters<typeof setGraphSetting>[1], label: string) =>
  void setGraphSetting(key, value, label);

function OptionRow({ def, graph }: { def: SurfaceOptionDef; graph: Graph }) {
  const v = graph.settings[def.id] ?? def.default;
  const expose = def.exposable ? (
    <Checkbox
      label="Expose in Material"
      checked={graph.settings[exposeKey(def.id)] === true}
      onChange={(c) => set(exposeKey(def.id), c ? true : null, `Expose ${def.label}`)}
      tooltip="Adds a ShaderLab-only material property (not part of the SRP Batcher CBUFFER)."
    />
  ) : null;
  switch (def.kind) {
    case "bool":
      return (
        <Field label={def.label} hint={def.tooltip}>
          <Checkbox
            label=""
            aria-label={def.label}
            checked={v === true}
            onChange={(c) => set(def.id, c === def.default ? null : c, `Edit ${def.label}`)}
          />
        </Field>
      );
    case "enum": {
      const gv = normalizeVersion(graph.settings.godotVersion);
      const options: SelectOption<string>[] = (def.values ?? []).map((x) => {
        const gated = !!x.since && !isSince(gv, x.since);
        return {
          value: x.id,
          label: x.unsupportedReason
            ? `${x.label} (unsupported)`
            : gated
              ? `${x.label} (needs Godot ${x.since}+)`
              : x.label,
          ...(x.unsupportedReason || gated
            ? {
                description:
                  x.unsupportedReason ?? `Requires Godot ${x.since} or newer; the selected version is ${gv}.`,
              }
            : {}),
        };
      });
      return (
        <Field label={def.label} hint={def.tooltip}>
          <Select<string>
            searchable={false}
            aria-label={def.label}
            value={String(v)}
            options={options}
            onChange={(n) => set(def.id, n === def.default ? null : n, `Edit ${def.label}`)}
          />
          {expose}
        </Field>
      );
    }
    default:
      return (
        <Field label={def.label} hint={def.tooltip}>
          <CommitNumber
            integer={def.kind === "int"}
            aria-label={def.label}
            value={Number(v)}
            {...(def.min !== undefined ? { min: def.min } : {})}
            {...(def.max !== undefined ? { max: def.max } : {})}
            onCommit={(n) => set(def.id, n === def.default ? null : n, `Edit ${def.label}`)}
          />
        </Field>
      );
  }
}

/** Graph Settings → Target: profile, Unity version, shader name, shader target, instancing and the profile's Surface Options. */
export function UnitySettings({ graph }: { graph: Graph }) {
  const profile = profileOf(graph);
  const profiles = targetProfiles.list();
  const options: SelectOption<string>[] = [
    { value: "generic", label: "Generic Fragment (portable)" },
    { value: "debug", label: "Master Output (debug)" },
    ...profiles.map((p) => ({
      value: p.id,
      label: p.label,
      ...(p.unavailableReason ? { disabled: true, description: p.unavailableReason } : {}),
    })),
  ];
  // Dropped-block problems are published to the Problems panel by switchTargetProfile.
  const onProfile = (id: string): void => void switchTargetProfile(id);
  const s = graph.settings;
  const version =
    typeof s.unityVersion === "string" ? s.unityVersion : (UNITY_VERSIONS.find((v) => v.default)?.id ?? "6000.3");
  const groups = new Map<string, SurfaceOptionDef[]>();
  for (const d of profile?.surfaceOptions ?? [])
    if (predicateHolds(d.shownWhen, profile!.surfaceOptions, s))
      groups.set(d.group ?? "Options", [...(groups.get(d.group ?? "Options") ?? []), d]);
  return (
    <>
      <Section title="Target">
        <Field
          label="Profile"
          hint="Switching keeps every node; wires to blocks the new profile lacks are removed and reported in the Problems panel."
        >
          <Select<string>
            searchable={false}
            aria-label="Target profile"
            value={graph.profileId}
            options={options}
            onChange={onProfile}
          />
        </Field>
        {profile?.engine === "godot" ? (
          <>
            <Field
              label="Godot Version"
              hint="Default 4.3: the exported code is valid unchanged on 4.3 → 4.7. Version-gated features are disabled below their first version."
            >
              <Select<string>
                searchable={false}
                aria-label="Godot version"
                value={normalizeVersion(s.godotVersion)}
                options={GODOT_VERSIONS.map((v) => ({ value: v.id, label: v.label }))}
                onChange={(n) => set("godotVersion", n === "4.3" ? null : n, "Godot version")}
              />
            </Field>
            <Field
              label="Renderer"
              hint="Only drives warnings / availability (e.g. hint_normal_roughness_texture works in Forward+ only)."
            >
              <Select<string>
                searchable={false}
                aria-label="Godot renderer"
                value={normalizeRenderer(s.godotRenderer)}
                options={GODOT_RENDERERS.map((r) => ({ value: r.id, label: r.label }))}
                onChange={(n) => set("godotRenderer", n === "all" ? null : n, "Godot renderer")}
              />
            </Field>
          </>
        ) : profile ? (
          <>
            <Field label="Unity Version">
              <Select<string>
                searchable={false}
                aria-label="Unity version"
                value={version}
                options={UNITY_VERSIONS.map((v) => ({ value: v.id, label: v.label }))}
                onChange={(n) => set("unityVersion", n, "Unity version")}
              />
            </Field>
            <Field label="Shader Name" hint="Kekenik/<GraphName>; quotes and backslashes are removed, // collapsed.">
              <CommitText
                aria-label="Shader name"
                value={typeof s.shaderName === "string" ? s.shaderName : defaultShaderName(graph.name)}
                onCommit={(v) =>
                  set(
                    "shaderName",
                    sanitizeShaderName(v) === defaultShaderName(graph.name) ? null : sanitizeShaderName(v),
                    "Shader name",
                  )
                }
              />
            </Field>
            <Field label="Shader Target">
              <Select<string>
                searchable={false}
                aria-label="Shader target"
                value={s.shaderTarget === "4.5" ? "4.5" : "3.5"}
                options={[
                  { value: "3.5", label: "3.5 (default)" },
                  { value: "4.5", label: "4.5" },
                ]}
                onChange={(n) => set("shaderTarget", n === "3.5" ? null : n, "Shader target")}
              />
            </Field>
            <Field label="GPU Instancing">
              <Checkbox
                label=""
                aria-label="GPU instancing"
                checked={
                  s.gpuInstancing === undefined
                    ? profile.family === "unlit" || profile.family === "lit"
                    : s.gpuInstancing === true
                }
                onChange={(c) => set("gpuInstancing", c, "GPU instancing")}
              />
            </Field>
            <Field
              label="Precision"
              hint="Set in Graph → Precision (Full / Auto / Half). Unity output uses half / half3 for demoted temporaries."
            >
              <Badge>
                {graph.settings.precision === "half" ? "half" : graph.settings.precision === "auto" ? "auto" : "float"}
              </Badge>
            </Field>
          </>
        ) : null}
      </Section>
      {[...groups.entries()].map(([group, defs]) => (
        <Section key={group} title={group}>
          {defs.map((d) => (
            <OptionRow key={d.id} def={d} graph={graph} />
          ))}
        </Section>
      ))}
    </>
  );
}
