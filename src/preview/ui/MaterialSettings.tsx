import { defaultProfileRegistry, type ParamValue } from "@/core";
import { useShader } from "@/app/shaderStore";
import { PropertyRow, PropertySection } from "@/ui";
import { ParamEditor } from "@/ui/graph/NodeEditors";
import { setGraphSetting } from "@/ui/graph/actions";
import { usePreview } from "../previewStore";

/**
 * Graph-level material settings of the active profile (blend mode, two-sided, soft particles …). The Preview honours them;
 * edits go through the core `setSettings` operation, so they are undoable like any other graph edit.
 */
export function MaterialSettings() {
  const graph = useShader((s) => s.graph);
  const mode = usePreview((s) => s.mode);
  const profile = graph ? defaultProfileRegistry.get(graph.profileId) : undefined;
  if (!graph || !profile)
    return <div className="kk-pv__note">Open or create a graph to edit its material settings.</div>;
  const soft = graph.settings.softParticles === true;
  const rows = profile.settings.filter((s) => s.id !== "softDistance" || soft);
  return (
    <PropertySection title={`Material · ${profile.name}`}>
      {rows.map((schema) => (
        <PropertyRow key={schema.id} label={schema.label} {...(schema.tooltip ? { hint: schema.tooltip } : {})}>
          <ParamEditor
            nodeId=""
            schema={schema}
            value={graph.settings[schema.id]}
            onSave={(v: ParamValue) => setGraphSetting(schema.id, v, `Set ${schema.label}`)}
          />
        </PropertyRow>
      ))}
      {soft && mode !== "vfx" && <div className="kk-pv__note">Soft particles are previewed in VFX mode only.</div>}
      <div className="kk-pv__note">
        These settings are stored in the graph. Blend mode, two-sided and soft particles are applied by the Preview.
      </div>
    </PropertySection>
  );
}
