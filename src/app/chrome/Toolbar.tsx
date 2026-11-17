import { Download, Redo2, Save, Undo2 } from "lucide-react";
import { IconButton, Select, formatShortcut, type IconType } from "@/ui";
import { getCommand, isCommandEnabled, runCommand, useCommands } from "../commands/registry";
import { applyPreset, useDockState } from "../dock/controller";
import { listPresets } from "../dock/layouts";
import { TargetSelect } from "./TargetSelect";

function CmdButton({ id, icon }: { id: string; icon?: IconType }) {
  const c = getCommand(id);
  if (!c) return null;
  const Icon = icon ?? c.icon!;
  const enabled = isCommandEnabled(c);
  const title = [
    c.title,
    c.shortcut ? `(${formatShortcut(c.shortcut)})` : "",
    c.disabledReason ? `— ${c.disabledReason}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return <IconButton icon={Icon} label={c.title} title={title} disabled={!enabled} onClick={() => runCommand(id)} />;
}

/** Toolbar. Buttons are bound to commands. */
export function Toolbar() {
  useCommands();
  const ready = useDockState((s) => s.ready);
  const presets = listPresets();
  return (
    <div className="kk-toolbar" data-ctx-scope="toolbar">
      <div className="kk-toolbar__group">
        <CmdButton id="file.save" icon={Save} />
        <CmdButton id="edit.undo" icon={Undo2} />
        <CmdButton id="edit.redo" icon={Redo2} />
      </div>
      <div className="kk-toolbar__sep" />
      <div className="kk-toolbar__group">
        <span className="kk-toolbar__label">Layout</span>
        <Select
          aria-label="Layout preset"
          value=""
          placeholder="Preset…"
          options={presets.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(id) => ready && applyPreset(id)}
        />
      </div>
      <div className="kk-toolbar__spacer" />
      <div className="kk-toolbar__group">
        <TargetSelect />
        <CmdButton id="file.export" icon={Download} />
      </div>
    </div>
  );
}
