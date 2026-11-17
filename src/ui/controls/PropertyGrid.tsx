import { ChevronDown, RotateCcw, Search } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cx } from "../util/cx";
import { beginDrag } from "./useDrag";
import { TextField } from "./TextField";
import type { Density } from "./types";

interface GridCtx {
  density: Density;
  filter: string;
  labelWidth: number;
}
const Grid = createContext<GridCtx>({ density: "regular", filter: "", labelWidth: 120 });

interface RowInfo {
  modified: boolean;
  visible: boolean;
  reset?: () => void;
}
interface SectionCtx {
  update(id: string, info: RowInfo | null): void;
  indent: number;
}
const Section = createContext<SectionCtx | null>(null);

export interface PropertyGridProps {
  children: ReactNode;
  density?: Density;
  /** Built-in filter box above the grid (matches row labels). */
  filterable?: boolean;
  /** Controlled filter text. */
  filter?: string;
  onFilterChange?: (v: string) => void;
  /** Initial label column width (px). The column divider is draggable. */
  labelWidth?: number;
  className?: string;
}

/** Property inspector container: resizable label column, built-in filter, consistent row heights (24 px regular / 20 px compact). */
export function PropertyGrid({
  children,
  density = "regular",
  filterable,
  filter,
  onFilterChange,
  labelWidth = 120,
  className,
}: PropertyGridProps) {
  const [w, setW] = useState(labelWidth);
  const [own, setOwn] = useState("");
  const f = filter ?? own;
  const ctx = useMemo(() => ({ density, filter: f.trim().toLowerCase(), labelWidth: w }), [density, f, w]);
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const w0 = w;
    beginDrag(
      {
        clientX: e.clientX,
        clientY: e.clientY,
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        target: e.currentTarget,
      },
      { bodyClass: "kk-resizing-h", onMove: (p) => setW(Math.max(60, Math.min(320, w0 + p.totalDx))) },
    );
  };
  return (
    <div
      data-kk="property-grid"
      data-density={density}
      className={cx("kk-pgrid", `kk-pgrid--${density}`, className)}
      style={{ ["--kk-label-w" as string]: `${w}px` } as CSSProperties}
    >
      {filterable && (
        <TextField
          value={f}
          onChange={(v) => (onFilterChange ? onFilterChange(v) : setOwn(v))}
          placeholder="Filter properties…"
          prefix={<Search size={12} />}
          clearable
          density="compact"
          aria-label="Filter properties"
          className="kk-pgrid__filter"
        />
      )}
      <Grid.Provider value={ctx}>{children}</Grid.Provider>
      <div
        className="kk-pgrid__divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize label column"
        tabIndex={0}
        style={{ left: `${w + 8}px` }}
        onPointerDown={startDrag}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setW((x) => Math.max(60, x - 8));
          else if (e.key === "ArrowRight") setW((x) => Math.min(320, x + 8));
        }}
      />
    </div>
  );
}

export interface PropertySectionProps {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Indent level for nested sections. */
  indent?: number;
  className?: string;
  /** Extra actions in the header (right side). */
  actions?: ReactNode;
}

/** Collapsible section; shows "Reset all" when any row inside is modified and hides itself when the filter matches nothing. */
export function PropertySection({
  title,
  children,
  defaultOpen = true,
  indent = 0,
  className,
  actions,
}: PropertySectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const rows = useRef(new Map<string, RowInfo>());
  const [agg, setAgg] = useState({ modified: 0, visible: 0, total: 0 });
  const { filter } = useContext(Grid);
  const update = useCallback((id: string, info: RowInfo | null) => {
    if (info) rows.current.set(id, info);
    else rows.current.delete(id);
    let modified = 0;
    let visible = 0;
    rows.current.forEach((r) => {
      if (r.modified) modified++;
      if (r.visible) visible++;
    });
    setAgg((a) =>
      a.modified === modified && a.visible === visible && a.total === rows.current.size
        ? a
        : { modified, visible, total: rows.current.size },
    );
  }, []);
  const ctx = useMemo(() => ({ update, indent: indent + 1 }), [update, indent]);
  const hidden = filter !== "" && agg.total > 0 && agg.visible === 0;
  const resetAll = () => rows.current.forEach((r) => r.modified && r.reset?.());
  const bodyId = useId();
  if (hidden)
    return (
      <Section.Provider value={ctx}>
        <div hidden>{children}</div>
      </Section.Provider>
    );
  return (
    <section
      data-kk="property-section"
      className={cx("kk-psec", open && "is-open", className)}
      style={{ ["--kk-indent" as string]: indent }}
    >
      <header className="kk-psec__head">
        <button
          type="button"
          className="kk-psec__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
        >
          <ChevronDown size={12} className="kk-psec__chev" />
          <span className="kk-psec__title">{title}</span>
        </button>
        {actions}
        {agg.modified > 0 && (
          <button
            type="button"
            className="kk-psec__reset"
            title={`Reset all (${agg.modified} modified)`}
            aria-label="Reset all in section"
            onClick={resetAll}
          >
            <RotateCcw size={11} />
          </button>
        )}
      </header>
      <Section.Provider value={ctx}>
        <div id={bodyId} className="kk-psec__body" hidden={!open && filter === ""}>
          {children}
        </div>
      </Section.Provider>
    </section>
  );
}

export interface PropertyRowProps {
  label: ReactNode;
  children: ReactNode;
  hint?: string;
  /** Shows a reset affordance (disabled unless `dirty`) and registers with the section's "Reset all". */
  onReset?: () => void;
  dirty?: boolean;
  /** Multi-selection with differing values. */
  mixed?: boolean;
  indent?: number;
  className?: string;
}

/** Label + control row. Compatible with the 1a PropertyRow (same classes/behaviour) plus grid integration. */
export function PropertyRow({ label, children, hint, onReset, dirty, mixed, indent, className }: PropertyRowProps) {
  const g = useContext(Grid);
  const sec = useContext(Section);
  const id = useId();
  const text = typeof label === "string" ? label : "";
  const visible = g.filter === "" || text.toLowerCase().includes(g.filter);
  const resetRef = useRef(onReset);
  resetRef.current = onReset;
  useEffect(() => {
    sec?.update(id, { modified: !!dirty, visible, reset: () => resetRef.current?.() });
    return () => sec?.update(id, null);
  }, [sec, id, dirty, visible]);
  if (!visible) return null;
  const lvl = indent ?? Math.max(0, (sec?.indent ?? 1) - 1);
  return (
    <div
      data-kk="property-row"
      data-density={g.density}
      className={cx("kk-prop", `kk-prop--${g.density}`, dirty && "is-dirty", mixed && "is-mixed", className)}
      title={hint}
      style={{ ["--kk-indent" as string]: lvl }}
    >
      <div className="kk-prop__label" onDoubleClick={() => dirty && onReset?.()}>
        <span className={cx("kk-modot", dirty && "is-on")} aria-hidden="true" />
        <span className="kk-prop__text">{label}</span>
      </div>
      <div className="kk-prop__control">{children}</div>
      {onReset && (
        <button
          type="button"
          className="kk-prop__reset"
          aria-label="Reset to default"
          title="Reset to default"
          disabled={!dirty}
          onClick={onReset}
        >
          ↺
        </button>
      )}
    </div>
  );
}
