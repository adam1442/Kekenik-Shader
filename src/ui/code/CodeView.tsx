import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { StreamLanguage } from "@codemirror/language";
import { shader } from "@codemirror/legacy-modes/mode/clike";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension, StateEffect, StateField, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useEffect, useRef } from "react";
import { cx } from "../util/cx";
import { kekenikHighlight, kekenikTheme } from "./theme";
import { hlslLanguage, wgslLanguage } from "./shaderLanguages";

type CodeLanguage = "glsl" | "wgsl" | "hlsl" | "plain";

export interface CodeViewProps {
  value: string;
  /** Syntax highlighting. GLSL (C-like shader mode) also reads fine for HLSL / WGSL until dedicated modes exist. */
  language?: CodeLanguage;
  /** Read-only views stay selectable/searchable (Ctrl/Cmd+F, copy). Default true. */
  readOnly?: boolean;
  onChange?: (value: string) => void;
  lineNumbers?: boolean;
  /** Accessible name of the editor. */
  label?: string;
  className?: string;
  /** Called with the 1-based line number when a line is clicked (source-map click-through). */
  onLineClick?: (line: number) => void;
  /** 1-based lines drawn with the "linked" highlight (lines originating from the selected graph nodes). */
  highlightLines?: readonly number[];
  /** Scroll this 1-based line into view when it changes. */
  revealLine?: number | undefined;
}

const setLines = StateEffect.define<readonly number[]>();
const linkedLine = Decoration.line({ class: "kk-code-linked" });
const linkedField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setLines)) continue;
      const b = new RangeSetBuilder<Decoration>();
      for (const n of [...e.value].sort((a, c) => a - c))
        if (n >= 1 && n <= tr.state.doc.lines) b.add(tr.state.doc.line(n).from, tr.state.doc.line(n).from, linkedLine);
      return b.finish();
    }
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

const glslLanguage = StreamLanguage.define(shader);

function languageExt(l: CodeLanguage): Extension {
  return l === "glsl" ? glslLanguage : l === "wgsl" ? wgslLanguage : l === "hlsl" ? hlslLanguage : [];
}

/**
 * CodeMirror 6 wrapper shared by the Code Output panel (read-only) and the future Custom Function editor.
 * Uncontrolled internally for performance: the document is only replaced when `value` differs from the editor text.
 */
export function CodeView({
  value,
  language = "glsl",
  readOnly = true,
  onChange,
  lineNumbers: gutter = true,
  label = "Code",
  className,
  onLineClick,
  highlightLines,
  revealLine,
}: CodeViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lineClickRef = useRef(onLineClick);
  lineClickRef.current = onLineClick;
  const lang = useRef(new Compartment());
  const ro = useRef(new Compartment());

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          gutter ? [lineNumbers(), highlightActiveLineGutter()] : [],
          highlightActiveLine(),
          highlightSelectionMatches(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          kekenikTheme,
          linkedField,
          EditorView.domEventHandlers({
            click(e, v) {
              const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
              if (pos !== null) lineClickRef.current?.(v.state.doc.lineAt(pos).number);
            },
          }),
          kekenikHighlight,
          lang.current.of(languageExt(language)),
          ro.current.of([EditorState.readOnly.of(readOnly)]),
          EditorView.contentAttributes.of({ "aria-label": label, "aria-readonly": String(readOnly) }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // The editor is created once; later prop changes are reconfigured by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gutter]);

  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === value) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: setLines.of(highlightLines ?? []) });
  }, [highlightLines, value]);

  useEffect(() => {
    const v = view.current;
    if (!v || !revealLine || revealLine < 1 || revealLine > v.state.doc.lines) return;
    v.dispatch({ effects: EditorView.scrollIntoView(v.state.doc.line(revealLine).from, { y: "center" }) });
  }, [revealLine, value]);

  useEffect(() => {
    view.current?.dispatch({ effects: lang.current.reconfigure(languageExt(language)) });
  }, [language]);

  useEffect(() => {
    view.current?.dispatch({ effects: ro.current.reconfigure([EditorState.readOnly.of(readOnly)]) });
  }, [readOnly]);

  return <div ref={host} data-kk="codeview" data-no-pan className={cx("kk-codeview", className)} />;
}
