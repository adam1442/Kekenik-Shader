import { Fragment, memo, useState } from "react";
import { InlineEditableLabel, TextArea } from "@/ui";
import { type Comment, type Group } from "@/core";
import { ChevronDown, ChevronRight } from "lucide-react";
import { setCommentText, setGroupTitle, toggleGroupCollapse, useFrameSel } from "./frameActions";
import { GROUP_HEAD } from "./frames";
import { borderWireCount, displayRect } from "./groupCollapse";
import { getScene, useGraphs } from "./graphStore";
import { type Block, type Inline, parseMarkdown } from "./markdown";

const inline = (i: Inline, k: number) => {
  switch (i.t) {
    case "b":
      return <strong key={k}>{i.text}</strong>;
    case "i":
      return <em key={k}>{i.text}</em>;
    case "code":
      return <code key={k}>{i.text}</code>;
    case "link":
      return (
        <a key={k} href={i.href} target="_blank" rel="noreferrer noopener" data-no-drag="">
          {i.text}
        </a>
      );
    default:
      return <Fragment key={k}>{i.text}</Fragment>;
  }
};
const block = (b: Block, k: number) => {
  const c = b.inlines.map(inline);
  switch (b.type) {
    case "h1":
      return <h1 key={k}>{c}</h1>;
    case "h2":
      return <h2 key={k}>{c}</h2>;
    case "h3":
      return <h3 key={k}>{c}</h3>;
    case "li":
      return (
        <div key={k} className="kk-md-li">
          {c}
        </div>
      );
    case "hr":
      return <hr key={k} />;
    case "blank":
      return <div key={k} className="kk-md-gap" />;
    default:
      return <p key={k}>{c}</p>;
  }
};
/** Rendered markdown of a comment (pure view of `parseMarkdown`). */
const Markdown = ({ text }: { text: string }) => <>{parseMarkdown(text).map(block)}</>;

const frameVars = (color: string | undefined) => (color ? ({ "--kk-frame": color } as React.CSSProperties) : undefined);

const GroupView = memo(function GroupView({ g, selected }: { g: Group; selected: boolean }) {
  const [editing, setEditing] = useState(false);
  const r = displayRect(g, (id) => getScene().rect(id));
  const Fold = g.collapsed ? ChevronRight : ChevronDown;
  const hiddenCount = g.collapsed ? [...getScene().collapse().nodes.values()].filter((x) => x === g.id).length : 0;
  const wires = g.collapsed ? borderWireCount(getScene().collapse(), getScene().graph, g.id) : 0;
  return (
    <div
      className="kk-group"
      data-frame-id={g.id}
      data-frame-kind="group"
      data-selected={selected || undefined}
      data-empty={g.nodeIds.length === 0 || undefined}
      data-collapsed={g.collapsed || undefined}
      style={{ width: r.w, height: r.h, transform: `translate(${r.x}px, ${r.y}px)`, ...frameVars(g.color) }}
    >
      <div
        className="kk-group__head"
        style={{ height: GROUP_HEAD }}
        data-ctx-scope="graph.group"
        data-ctx-id={g.id}
        onDoubleClick={() => setEditing(true)}
      >
        <button
          type="button"
          className="kk-group__fold"
          data-no-drag=""
          data-testid="group-fold"
          aria-expanded={!g.collapsed}
          aria-label={g.collapsed ? "Expand group" : "Collapse group"}
          title={
            g.collapsed ? `Expand group${wires ? ` (${wires} wires attach to its border)` : ""}` : "Collapse group"
          }
          onClick={() => toggleGroupCollapse(g.id)}
        >
          <Fold size={14} />
        </button>
        {editing ? (
          <div className="kk-group__edit" data-no-drag="">
            <InlineEditableLabel
              editing
              value={g.title}
              aria-label="Group title"
              onCommit={(v) => (setEditing(false), v.trim() && v !== g.title && setGroupTitle(g.id, v.trim()))}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <span className="kk-group__title">{g.title || "Group"}</span>
        )}
        <span className="kk-group__count" data-testid="group-count">
          {g.collapsed ? hiddenCount : g.nodeIds.length}
        </span>
      </div>
      {!g.collapsed && <div className="kk-frame__resize" data-frame-handle="resize" title="Resize" />}
    </div>
  );
});

const CommentView = memo(function CommentView({ c, selected }: { c: Comment; selected: boolean }) {
  const [editing, setEditing] = useState(false);
  return (
    <div
      className="kk-comment"
      data-frame-id={c.id}
      data-frame-kind="comment"
      data-selected={selected || undefined}
      data-ctx-scope="graph.comment"
      data-ctx-id={c.id}
      style={{
        width: c.size.w,
        height: c.size.h,
        transform: `translate(${c.position.x}px, ${c.position.y}px)`,
        ...frameVars(c.color),
      }}
      onDoubleClick={() => setEditing(true)}
    >
      {editing ? (
        <div className="kk-comment__edit" data-no-pan="" data-no-drag="">
          <TextArea
            value={c.text}
            rows={4}
            density="compact"
            aria-label="Comment text"
            onCommit={(v) => (setEditing(false), v !== c.text && setCommentText(c.id, v))}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <div className="kk-comment__body" data-testid="comment-body">
          <Markdown text={c.text} />
        </div>
      )}
      <div className="kk-frame__resize" data-frame-handle="resize" title="Resize" />
    </div>
  );
});

/** Groups and comments live BEHIND the nodes (their bodies never capture the pointer; only title bars, notes and handles do). */
export function FramesLayer() {
  const graph = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.graph);
  const sel = useFrameSel((s) => s.sel);
  const hidden = graph ? getScene().collapse().groups : new Set<string>();
  if (!graph || (graph.groups.length === 0 && graph.comments.length === 0)) return null;
  return (
    <>
      {graph.groups
        .filter((g) => !hidden.has(g.id))
        .map((g) => (
          <GroupView key={g.id} g={g} selected={sel?.id === g.id} />
        ))}
      {graph.comments.map((c) => (
        <CommentView key={c.id} c={c} selected={sel?.id === c.id} />
      ))}
    </>
  );
}
