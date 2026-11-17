import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Badge, Button, Modal, ScrollArea, Tabs } from "@/ui";
import { defaultNodeRegistry } from "@/core";
import { ShortcutList } from "../chrome/Dialogs";
import { usePrefs } from "../prefs/preferences";
import { APP_NAME, APP_STAGE, APP_VERSION, GITHUB_DOCS_URL, GITHUB_ISSUES_URL, GITHUB_REPO_URL } from "../lib/version";
import { LICENSES } from "./licenses.generated";
import { useProUi } from "./proState";
import { TIPS } from "./templates";

/** Canvas gestures that are not commands (so they are not in the command shortcut list). */
const GESTURES: ReadonlyArray<readonly [string, string]> = [
  ["Space (tap)", "Search and add a node"],
  ["Drag from a port", "Create a wire; release on empty space to add a linked node"],
  ["Click a port’s “+”", "Add a node already wired to that port"],
  ["Shift + drag from an output", "Move all wires of that output to another output"],
  ["Drag an input’s wire away", "Pick the wire up (drop on nothing to delete it)"],
  ["Middle mouse / Space + drag", "Pan"],
  ["Wheel / pinch", "Zoom at the cursor"],
  ["Drag an asset onto the canvas", "Texture property + Sample Texture 2D, bound in the preview"],
  ["Drag a node onto a wire", "Insert the node into the wire"],
];

type Tab = "guide" | "keys" | "licenses";

/** Help panel: getting-started tips + gesture cheat sheet, full shortcut list, generated third-party licenses. */
export function HelpDialog() {
  const open = useProUi((s) => s.helpOpen);
  const close = () => useProUi.getState().set({ helpOpen: false });
  const quick = usePrefs((s) => s.quickNodes);
  const [tab, setTab] = useState<Tab>("guide");
  return (
    <Modal
      open={open}
      onClose={close}
      title={`${APP_NAME} — Documentation & Help`}
      width={640}
      footer={
        <>
          <Badge>
            v{APP_VERSION} · {APP_STAGE}
          </Badge>
          <Button variant="primary" onClick={close}>
            Close
          </Button>
        </>
      }
    >
      <div className="kk-pro" style={{ padding: 0 }} data-kk="help">
        <Tabs
          value={tab}
          onChange={(t) => setTab(t as Tab)}
          items={[
            { id: "guide", label: "Guide" },
            { id: "keys", label: "Shortcuts" },
            { id: "licenses", label: "Licenses" },
          ]}
        />
        {tab === "guide" && (
          <ScrollArea style={{ maxHeight: "55vh" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <a className="kk-btn kk-btn--sm" href={GITHUB_DOCS_URL} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={12} /> Online Documentation
              </a>
              <a className="kk-btn kk-btn--sm" href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={12} /> GitHub Repository
              </a>
              <a className="kk-btn kk-btn--sm" href={GITHUB_ISSUES_URL} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={12} /> Report an Issue
              </a>
            </div>
            <h3>Canvas gestures</h3>
            <table className="kk-pro__table">
              <tbody>
                {GESTURES.map(([a, b]) => (
                  <tr key={a}>
                    <td>
                      <b>{a}</b>
                    </td>
                    <td>{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>Quick nodes (press the key over the canvas)</h3>
            <div className="kk-pro__grid">
              {Object.entries(quick)
                .sort(([a], [b]) => (a < b ? -1 : 1))
                .map(([k, id]) => (
                  <span key={k} className="kk-pro__kbd">
                    <kbd className="kk-kbd">{k.toUpperCase()}</kbd> {defaultNodeRegistry.get(id)?.name ?? id}
                  </span>
                ))}
            </div>
            <div className="kk-pro__muted">Edit the keys in Preferences → Quick nodes.</div>
            <h3>Tips</h3>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {TIPS.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </ScrollArea>
        )}
        {tab === "keys" && <ShortcutList />}
        {tab === "licenses" && (
          <ScrollArea style={{ maxHeight: "55vh" }}>
            <div className="kk-pro__muted" style={{ marginBottom: 8 }}>
              {APP_NAME} is released under the MIT License and bundles these open-source packages (including Inter and
              JetBrains Mono under SIL OFL 1.1; see <code>THIRD_PARTY_LICENSES.md</code> in the repository for full
              license texts):
            </div>
            <table className="kk-pro__table" data-kk="licenses">
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
