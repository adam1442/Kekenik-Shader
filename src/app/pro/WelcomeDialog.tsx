import { useEffect, useState } from "react";
import {
  ExternalLink,
  FilePlus2,
  FlaskConical,
  FolderOpen,
  History,
  LifeBuoy,
  Lightbulb,
  ShieldCheck,
} from "lucide-react";
import { GRAPH_TEMPLATES, type TemplateEngine, parseKShader } from "@/core";
import { Badge, Button, Modal, SegmentedControl, toast } from "@/ui";
import { SampleCard } from "@/app/samples/SampleBrowser";
import { openSampleAsProject } from "@/app/samples/actions";
import { useSamples } from "@/app/samples/sampleStore";
import { openDoc } from "@/ui/graph/graphStore";
import { openPanel } from "@/app/dock/controller";
import { openProject } from "@/app/project/projectIo";
import { clearRecovery, useRecovery } from "@/app/project/recovery";
import { listRecents, type RecentProject } from "@/app/project/recents";
import { snapshots } from "@/app/project/snapshotStore";
import {
  APP_LICENSE,
  APP_NAME,
  APP_STAGE,
  APP_VERSION,
  GITHUB_DOCS_URL,
  GITHUB_ISSUES_URL,
  GITHUB_REPO_URL,
} from "../lib/version";
import { restoreRecovery } from "./session";
import { useProUi } from "./proState";
import { openTemplate, tipOfTheDay } from "./templates";

const timeAgo = (t: number): string => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1
    ? "just now"
    : m < 60
      ? `${m} min ago`
      : m < 1440
        ? `${Math.round(m / 60)} h ago`
        : `${Math.round(m / 1440)} d ago`;
};

/** Welcome screen: release overview, recovery offer, new-from-template, samples, recent projects, tip of the day. */
export function WelcomeDialog() {
  const open = useProUi((s) => s.welcomeOpen);
  const close = () => useProUi.getState().set({ welcomeOpen: false });
  const rec = useRecovery((s) => s.record);
  const [engine, setEngine] = useState<TemplateEngine>("unity");
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const samples = useSamples((st) => st.entries);
  const loadSamples = useSamples((st) => st.load);
  useEffect(() => {
    if (open) {
      setRecents(listRecents());
      void loadSamples();
    }
  }, [open, loadSamples]);

  const openRecent = async (r: RecentProject) => {
    const s = await snapshots.get(r.snapshotId);
    if (!s)
      return void toast.show({
        title: "That copy is no longer in local history",
        description: "Use Open… to load the file.",
        kind: "warning",
      });
    openDoc(parseKShader(s.text).graph, { fit: true });
    close();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title={`Welcome to ${APP_NAME}`}
      width={680}
      footer={
        <>
          <Button
            icon={FolderOpen}
            onClick={() => {
              close();
              void openProject();
            }}
          >
            Open file…
          </Button>
          <Button variant="primary" onClick={close}>
            Start with the current graph
          </Button>
        </>
      }
    >
      <div className="kk-pro" style={{ padding: 0 }} data-kk="welcome">
        <div className="kk-pro__hint" data-sev="info" style={{ alignItems: "flex-start" }}>
          <ShieldCheck size={16} style={{ marginTop: 2, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
              <strong>
                {APP_NAME} v{APP_VERSION}
              </strong>
              <Badge tone="warning">{APP_STAGE}</Badge>
              <Badge>{APP_LICENSE} License</Badge>
            </div>
            <div>
              Open-source, browser-based node shader editor for GLSL, HLSL, WGSL, Godot 4, and Unity URP. This is an
              early preview: many features need more work and known issues remain. Runs entirely in your browser with no
              analytics or external network calls.
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <ExternalLink size={11} /> GitHub Repository
              </a>
              <a
                href={GITHUB_ISSUES_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <ExternalLink size={11} /> Report an Issue
              </a>
              <a
                href={GITHUB_DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <ExternalLink size={11} /> Documentation
              </a>
            </div>
          </div>
        </div>
        {rec && (
          <div className="kk-pro__hint" data-sev="warning" data-kk="recovery">
            <LifeBuoy size={16} />
            <span style={{ flex: 1 }}>
              The last session ended unexpectedly. A recovery copy of “{rec.name}” from {timeAgo(rec.time)} is
              available.
            </span>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                if (restoreRecovery(rec)) close();
              }}
            >
              Restore
            </Button>
            <Button
              size="sm"
              onClick={() => {
                clearRecovery();
                useRecovery.getState().set(null);
              }}
            >
              Discard
            </Button>
          </div>
        )}
        <h3>New from template</h3>
        <SegmentedControl<TemplateEngine>
          value={engine}
          aria-label="Template engine"
          options={[
            { value: "unity", label: "Unity URP" },
            { value: "godot", label: "Godot 4" },
          ]}
          onChange={setEngine}
        />
        <div className="kk-pro__grid">
          {GRAPH_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              className="kk-pro__card kk-pro__tpl"
              data-template={t.id}
              onClick={() => {
                if (openTemplate(t.id, engine)) close();
              }}
            >
              <strong>
                <FilePlus2 size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
                {t.name} <Badge>{t.kind}</Badge>
              </strong>
              <span>{t.description}</span>
            </button>
          ))}
        </div>
        <h3>Samples</h3>
        <div className="kk-smp__strip" data-kk="welcome-samples">
          {samples.slice(0, 6).map((e) => (
            <SampleCard
              key={e.id}
              entry={e}
              onOpen={() =>
                void openSampleAsProject(e).then((id) => {
                  if (id) close();
                })
              }
            />
          ))}
        </div>
        <Button
          size="sm"
          icon={FlaskConical}
          data-kk="browse-samples"
          onClick={() => {
            close();
            openPanel("samples");
          }}
        >
          Browse all samples…
        </Button>
        <h3>Recent</h3>
        {recents.length === 0 ? (
          <div className="kk-pro__muted">Saved projects appear here.</div>
        ) : (
          recents.map((r) => (
            <button key={r.name} type="button" className="kk-pro__card kk-pro__tpl" onClick={() => void openRecent(r)}>
              <strong>
                <History size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
                {r.name}
              </strong>
              <span>{timeAgo(r.time)}</span>
            </button>
          ))
        )}
        <div className="kk-pro__hint" data-sev="info">
          <Lightbulb size={14} />
          <span>{tipOfTheDay()}</span>
        </div>
      </div>
    </Modal>
  );
}
