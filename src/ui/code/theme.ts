import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/** CodeMirror dark theme built on the Kekenik design tokens (CSS variables resolve at paint time). */
export const kekenikTheme: Extension = EditorView.theme(
  {
    "&": { height: "100%", color: "var(--kk-text-1)", backgroundColor: "var(--kk-surface-1)", fontSize: "12px" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "var(--kk-font-mono)", lineHeight: "1.55", overflow: "auto" },
    ".cm-content": { caretColor: "var(--kk-accent-hover)", padding: "6px 0" },
    ".cm-line": { padding: "0 12px 0 6px" },
    ".cm-gutters": {
      backgroundColor: "var(--kk-surface-1)",
      color: "var(--kk-text-3)",
      border: "none",
      borderRight: "1px solid var(--kk-border-subtle)",
    },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 10px", minWidth: "32px" },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.03)" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(255,255,255,0.03)", color: "var(--kk-text-2)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
      backgroundColor: "var(--kk-accent-soft)",
    },
    ".cm-cursor": { borderLeftColor: "var(--kk-accent-hover)" },
    ".cm-panels": {
      backgroundColor: "var(--kk-surface-3)",
      color: "var(--kk-text-1)",
      borderColor: "var(--kk-border)",
    },
    ".cm-panels input, .cm-panels button": { fontFamily: "var(--kk-font-sans)", fontSize: "11px" },
    ".cm-searchMatch": { backgroundColor: "var(--kk-warning-soft)", outline: "1px solid var(--kk-warning)" },
    ".cm-searchMatch-selected": { backgroundColor: "var(--kk-accent-soft)" },
  },
  { dark: true },
);

const style = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.modifier], color: "#c4a7ff" },
  { tag: [t.typeName, t.standard(t.typeName)], color: "#7ed3f5" },
  { tag: [t.number, t.bool, t.atom], color: "#f5b36e" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--kk-text-3)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.standard(t.variableName)], color: "#9ee37d" },
  { tag: [t.string, t.special(t.string)], color: "#f0a0b8" },
  { tag: [t.meta, t.processingInstruction], color: "#d58bf0" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "var(--kk-text-2)" },
  { tag: [t.variableName, t.propertyName], color: "var(--kk-text-1)" },
]);

export const kekenikHighlight: Extension = syntaxHighlighting(style);
