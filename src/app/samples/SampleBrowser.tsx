import { useEffect, useMemo, useRef, useState } from "react";
import { FlaskConical, RefreshCw } from "lucide-react";
import { SAMPLE_BUDGETS, SAMPLE_CATEGORIES, SAMPLE_DIFFICULTIES, SAMPLE_TARGETS, type SampleFilter, type SampleIndexEntry, EMPTY_SAMPLE_FILTER, sampleTags } from "@/core";
import { Badge, Button, EmptyState, SearchField, Select } from "@/ui";
import { SampleDetails } from "./SampleDetails";
import { openSampleAsProject } from "./actions";
import { useSamples, visibleSamples } from "./sampleStore";
import { sampleThumbnail } from "./thumbs";

/** Live thumbnail of a sample (rendered lazily through the shared thumbnail renderer). */
function SampleThumb({ entry, size = 192 }: { entry: SampleIndexEntry; size?: number }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const host = useRef<HTMLDivElement>(null);
  // Lazy: the render is only requested once the card scrolls into view (26+ samples must not queue 26 GPU compiles on open).
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (seen || !host.current) return;
    const io = new IntersectionObserver((rows) => { if (rows.some((r) => r.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: "120px" });
    io.observe(host.current);
    return () => io.disconnect();
  }, [seen]);
  useEffect(() => {
    if (!seen) return;
    let alive = true;
    void sampleThumbnail(entry, size).then((u) => { if (alive) setUrl(u); }, () => { if (alive) setUrl(null); });
    return () => { alive = false; };
  }, [entry, size, seen]);
  return (
    <div ref={host} className="kk-smp__thumb" data-state={url === undefined ? "loading" : url ? "ready" : "none"}>
      {url ? <img src={url} alt="" draggable={false} /> : <FlaskConical size={22} />}
    </div>
  );
}

const opts = <T extends string>(all: string, xs: readonly T[]): { value: T | "all"; label: string }[] => [{ value: "all", label: all }, ...xs.map((x) => ({ value: x, label: x }))];

/** Card grid of one result list (shared by the panel and the Welcome section). */
export function SampleCard({ entry, selected, onSelect, onOpen }: { entry: SampleIndexEntry; selected?: boolean; onSelect?: () => void; onOpen: () => void }) {
  return (
    <button type="button" className="kk-smp__card" data-sample={entry.id} data-selected={selected ? "true" : "false"} onClick={onSelect ?? onOpen} onDoubleClick={onOpen}>
      <SampleThumb entry={entry} />
      <strong>{entry.title}</strong>
      <span className="kk-smp__meta"><Badge>{entry.category.replace(" / ", " · ")}</Badge><Badge>{entry.difficulty}</Badge></span>
    </button>
  );
}

/** The Sample Browser panel: search, filters, card grid and the details drawer. */
export function SampleBrowser() {
  const { status, entries, error, filter, selectedId, load, setFilter, select } = useSamples();
  useEffect(() => { void load(); }, [load]);
  // NOT `useSamples((s) => visibleSamples(s))`: that selector returns a fresh array on every call, which makes zustand v5's
  // useSyncExternalStore loop forever (React error #185, tests 11a.browser.panel-events). Derive from stable slices instead.
  const shown = useMemo(() => visibleSamples({ entries, filter }), [entries, filter]);
  const tags = useMemo(() => sampleTags(entries), [entries]);
  const selected = entries.find((e) => e.id === selectedId) ?? null;
  const active = JSON.stringify(filter) !== JSON.stringify(EMPTY_SAMPLE_FILTER);
  const set = (p: Partial<SampleFilter>) => setFilter(p);
  return (
    <div className="kk-smp" data-kk="sample-browser">
      <div className="kk-smp__main">
        <div className="kk-smp__bar">
          <SearchField value={filter.query} onChange={(query) => set({ query })} placeholder="Search samples, tags, parameters…" aria-label="Search samples" />
          <Select<SampleFilter["category"]> value={filter.category} options={opts("All categories", SAMPLE_CATEGORIES)} onChange={(category) => set({ category })} density="compact" />
          <Select<SampleFilter["target"]> value={filter.target} options={opts("All targets", SAMPLE_TARGETS)} onChange={(target) => set({ target })} density="compact" />
          <Select<SampleFilter["difficulty"]> value={filter.difficulty} options={opts("Any difficulty", SAMPLE_DIFFICULTIES)} onChange={(difficulty) => set({ difficulty })} density="compact" />
          <Select<SampleFilter["budget"]> value={filter.budget} options={opts("Any budget", SAMPLE_BUDGETS)} onChange={(budget) => set({ budget })} density="compact" />
        </div>
        <div className="kk-smp__tags">
          {tags.map((t) => <button key={t} type="button" className="kk-smp__tag" data-tag={t} data-on={filter.tag === t ? "true" : "false"} onClick={() => set({ tag: filter.tag === t ? null : t })}>{t}</button>)}
          <span className="kk-smp__count" data-kk="sample-count">{shown.length} of {entries.length}{active && <Button size="sm" variant="ghost" onClick={() => setFilter(EMPTY_SAMPLE_FILTER)}>Clear</Button>}</span>
        </div>
        {status === "loading" || status === "idle" ? <EmptyState title="Loading samples…" /> : null}
        {status === "error" ? <EmptyState title="Samples could not be loaded" description={`${error}. The samples folder must be served next to index.html.`} actions={<Button icon={RefreshCw} onClick={() => void load(true)}>Retry</Button>} /> : null}
        {status === "ready" && shown.length === 0 ? <EmptyState title="No sample matches" description="Try a different search or clear the filters." /> : null}
        <div className="kk-smp__grid">
          {shown.map((e) => <SampleCard key={e.id} entry={e} selected={e.id === selectedId} onSelect={() => select(e.id)} onOpen={() => void openSampleAsProject(e)} />)}
        </div>
      </div>
      {selected && <SampleDetails entry={selected} onClose={() => select(null)} />}
    </div>
  );
}
