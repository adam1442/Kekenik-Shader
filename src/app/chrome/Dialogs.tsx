import { ExternalLink, Hexagon, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Kbd, Modal, ScrollArea, Tabs, TextField } from "@/ui";
import { findKeybindingConflicts, useCommands } from "../commands/registry";
import { saveCustomLayout } from "../dock/controller";
import {
  APP_AUTHOR,
  APP_CONTACT,
  APP_LICENSE,
  APP_NAME,
  APP_STAGE,
  APP_VERSION,
  GITHUB_DOCS_URL,
  GITHUB_ISSUES_URL,
  GITHUB_REPO_URL,
  LIVE_DEMO_URL,
} from "../lib/version";
import { LICENSES } from "../pro/licenses.generated";
import { setStatus, useUi } from "../state";

type AboutTab = "overview" | "licenses";

export function AboutDialog() {
  const open = useUi((s) => s.aboutOpen);
  const set = useUi((s) => s.setAbout);
  const [tab, setTab] = useState<AboutTab>("overview");
  return (
    <Modal
      open={open}
      onClose={() => set(false)}
      title={`About ${APP_NAME}`}
      width={540}
      footer={
        <Button variant="primary" onClick={() => set(false)}>
          Close
        </Button>
      }
    >
      <div className="kk-pro" style={{ padding: 0 }} data-kk="about">
        <Tabs
          value={tab}
          onChange={(t) => setTab(t as AboutTab)}
          items={[
            { id: "overview", label: "Overview" },
            { id: "licenses", label: `Third-Party Licenses (${LICENSES.length})` },
          ]}
        />
        {tab === "overview" && (
          <div className="kk-about" style={{ paddingTop: 8 }}>
            <div className="kk-about__logo">
              <Hexagon size={34} strokeWidth={1.8} />
            </div>
            <div className="kk-about__name">{APP_NAME}</div>
            <div
              className="kk-about__meta"
              style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}
            >
              <Badge tone="accent">v{APP_VERSION}</Badge>
              <Badge tone="warning">{APP_STAGE}</Badge>
              <Badge>{APP_LICENSE} License</Badge>
            </div>
            <p>
              A browser-based, engine-independent, node-based shader editor. Build one graph and export to GLSL (WebGL2
              / GLSL ES 3.00), HLSL, WGSL, Godot Shading Language (4.x) and Unity URP.
            </p>
            <div className="kk-pro__hint" data-sev="warning" style={{ textAlign: "left", width: "100%" }}>
              <span>
                <strong>Early preview (v{APP_VERSION}):</strong> many features still need more work and known issues
                remain. Please report bugs and feedback on GitHub Issues.
              </span>
            </div>
            <div className="kk-pro__hint" data-sev="info" style={{ textAlign: "left", width: "100%" }}>
              <ShieldCheck size={16} style={{ flexShrink: 0 }} />
              <span>
                <strong>Privacy:</strong> {APP_NAME} runs entirely in your browser. There is no analytics, telemetry, or
                tracking, and no network calls are made except user-initiated file or sample loads.
              </span>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                justifyContent: "center",
                width: "100%",
                marginTop: 4,
              }}
            >
              <a className="kk-btn kk-btn--sm" href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={12} /> GitHub Repository
              </a>
              <a className="kk-btn kk-btn--sm" href={GITHUB_ISSUES_URL} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={12} /> Report an Issue
              </a>
              <a className="kk-btn kk-btn--sm" href={GITHUB_DOCS_URL} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={12} /> Documentation
              </a>
              <a className="kk-btn kk-btn--sm" href={LIVE_DEMO_URL} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={12} /> Live Demo
              </a>
            </div>
            <div className="kk-about__build kk-mono kk-selectable" style={{ marginTop: 4 }}>
              Created by {APP_AUTHOR} ({APP_CONTACT}) · Released under the {APP_LICENSE} License
            </div>
          </div>
        )}
        {tab === "licenses" && (
          <ScrollArea style={{ maxHeight: "52vh" }}>
            <div className="kk-pro__muted" style={{ marginBottom: 8 }}>
              {APP_NAME} is released under the {APP_LICENSE} License and bundles these open-source packages:
            </div>
            <table className="kk-pro__table" data-kk="about-licenses">
              <thead>
                <tr>
                  <th>Package</th>
                  <th>Version</th>
                  <th>License</th>
                </tr>
              </thead>
              <tbody>
                {LICENSES.map((l) => (
                  <tr key={l.name}>
                    <td>
                      {l.homepage ? (
                        <a href={l.homepage} target="_blank" rel="noopener noreferrer">
                          {l.name}
                        </a>
                      ) : (
                        l.name
                      )}
                    </td>
                    <td>{l.version}</td>
                    <td>{l.license}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </div>
    </Modal>
  );
}

/** Command shortcut list grouped by category (shared by the Shortcuts dialog and the Help dialog). */
export function ShortcutList() {
  const commands = useCommands();
  const withKeys = commands.filter((c) => c.shortcut);
  const categories = Array.from(new Set(withKeys.map((c) => c.category)));
  const conflicts = findKeybindingConflicts(commands);
  return (
    <ScrollArea style={{ maxHeight: "55vh" }}>
      {conflicts.length > 0 && (
        <div className="kk-shortcuts__warn">
          Conflicts: {conflicts.map((c) => `${c.shortcut} (${c.commandIds.join(", ")})`).join("; ")}
        </div>
      )}
      {categories.map((cat) => (
        <div key={cat} className="kk-shortcuts__group">
          <div className="kk-shortcuts__cat">{cat}</div>
          {withKeys
            .filter((c) => c.category === cat)
            .map((c) => (
              <div key={c.id} className="kk-shortcuts__row" data-disabled={c.disabledReason ? "1" : undefined}>
                <span>{c.title}</span>
                {c.disabledReason && <span className="kk-shortcuts__reason">{c.disabledReason}</span>}
                <Kbd shortcut={c.shortcut} />
              </div>
            ))}
        </div>
      ))}
    </ScrollArea>
  );
}

export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen);
  const set = useUi((s) => s.setShortcuts);
  return (
    <Modal
      open={open}
      onClose={() => set(false)}
      title="Keyboard Shortcuts"
      width={520}
      footer={<Button onClick={() => set(false)}>Close</Button>}
    >
      <ShortcutList />
    </Modal>
  );
}

export function SaveLayoutDialog() {
  const open = useUi((s) => s.saveLayoutOpen);
  const set = useUi((s) => s.setSaveLayout);
  const [name, setName] = useState("");
  useEffect(() => {
    if (open) setName("My Layout");
  }, [open]);
  const save = () => {
    const entry = saveCustomLayout(name);
    if (entry) {
      setStatus(`Layout "${entry.name}" saved`);
      set(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={() => set(false)}
      title="Save Layout"
      width={380}
      footer={
        <>
          <Button onClick={() => set(false)}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="kk-field-label">Layout name</div>
      <TextField
        value={name}
        autoFocus
        selectOnFocus
        aria-label="Layout name"
        onChange={setName}
        onKeyDown={(e) => e.key === "Enter" && save()}
      />
    </Modal>
  );
}
