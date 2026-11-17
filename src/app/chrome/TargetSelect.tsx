import { useState } from "react";
import { Button, Modal, Select, type SelectOption } from "@/ui";
import { type TargetFamily, TARGET_FAMILIES } from "@/core";
import { type TargetSwitchPreview, previewTargetSwitch, switchTarget, useTarget } from "../target/targetActions";

const OPTIONS: SelectOption<TargetFamily>[] = TARGET_FAMILIES.map((f) => ({
  value: f.id,
  label: f.label,
  description: f.hint,
}));

/**
 * Toolbar Target dropdown (next to Export): Unity URP · Godot 4 · Web GLSL · WebGPU WGSL · D3D HLSL. Switching maps the profile to the same
 * kind in the new family; when wires would be dropped a confirmation dialog lists them first. One undo step.
 */
export function TargetSelect() {
  const target = useTarget();
  const [pending, setPending] = useState<TargetSwitchPreview | null>(null);
  const request = (family: TargetFamily): void => {
    const p = previewTargetSwitch(family);
    if (p.noop) return;
    if (p.problems.length === 0) switchTarget(family);
    else setPending(p);
  };
  return (
    <>
      <span className="kk-toolbar__label">Target</span>
      <Select<TargetFamily>
        aria-label="Target"
        data-testid="target-select"
        value={target}
        options={OPTIONS}
        searchable={false}
        onChange={request}
      />
      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title={`Switch target to ${TARGET_FAMILIES.find((f) => f.id === pending?.family)?.label ?? ""}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              data-action="target-confirm"
              onClick={() => {
                if (pending) switchTarget(pending.family);
                setPending(null);
              }}
            >
              Switch
            </Button>
          </>
        }
      >
        <p>
          These connections / blocks do not exist in the new target and will be removed (undoable). No node is deleted.
        </p>
        <ul data-testid="target-drops">
          {pending?.problems.map((p, i) => (
            <li key={i}>{p.message}</li>
          ))}
        </ul>
      </Modal>
    </>
  );
}
