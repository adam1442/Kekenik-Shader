import { useState } from "react";
import { Button, PropertyRow, PropertySection, Select, TextField, type SelectOption } from "@/ui";
import {
  deleteMaterialPreset,
  exportMaterialJson,
  listMaterialPresets,
  loadMaterialPreset,
  saveMaterialPreset,
} from "@/app/project/previewState";

/** Named material presets (Material overrides + keyword variant + texture bindings): save / load / delete / export `material.json`. Stored in the project file. */
export function MaterialPresets() {
  const [name, setName] = useState("Preset 1");
  const [sel, setSel] = useState("");
  const [, bump] = useState(0);
  const names = listMaterialPresets();
  const opts: SelectOption<string>[] = names.map((n) => ({ value: n, label: n }));
  return (
    <PropertySection title="Material presets" defaultOpen={false}>
      <PropertyRow label="Name">
        <TextField density="compact" value={name} onChange={setName} aria-label="Preset name" />
      </PropertyRow>
      <PropertyRow label="">
        <Button
          size="sm"
          variant="ghost"
          data-action="material-preset-save"
          onClick={() => {
            saveMaterialPreset(name);
            setSel(name.trim());
            bump((n) => n + 1);
          }}
        >
          Save current material
        </Button>
      </PropertyRow>
      <PropertyRow label="Presets">
        <Select<string>
          density="compact"
          value={sel}
          options={opts}
          placeholder={names.length ? "Pick a preset…" : "No presets yet"}
          onChange={setSel}
          searchable={false}
          aria-label="Material presets"
        />
      </PropertyRow>
      <PropertyRow label="">
        <div className="kk-pv__btns">
          <Button
            size="sm"
            variant="ghost"
            disabled={!sel}
            data-action="material-preset-load"
            onClick={() => loadMaterialPreset(sel)}
          >
            Load
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!sel}
            onClick={() => {
              deleteMaterialPreset(sel);
              setSel("");
              bump((n) => n + 1);
            }}
          >
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => exportMaterialJson(sel || "material")}>
            Export material.json
          </Button>
        </div>
      </PropertyRow>
    </PropertySection>
  );
}
