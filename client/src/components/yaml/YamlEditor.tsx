import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { yaml } from "@codemirror/lang-yaml";
import { tags as t } from "@lezer/highlight";
import { locate, type YamlLocation } from "./yaml-path";

/** Colors come from the app's palette tokens, so the editor follows every light and dark theme. */
const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "12px", backgroundColor: "transparent", color: "hsl(var(--foreground))" },
  ".cm-scroller": { fontFamily: "var(--font-mono, ui-monospace, monospace)", lineHeight: "1.6" },
  ".cm-content": { caretColor: "hsl(var(--primary))", padding: "10px 0" },
  ".cm-gutters": { backgroundColor: "transparent", color: "hsl(var(--muted-foreground) / 0.6)", border: "none" },
  ".cm-activeLine": { backgroundColor: "hsl(var(--primary) / 0.06)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "hsl(var(--foreground))" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "hsl(var(--primary) / 0.22) !important" },
  ".cm-cursor": { borderLeftColor: "hsl(var(--primary))" },
  ".cm-matchingBracket": { backgroundColor: "hsl(var(--primary) / 0.15)", outline: "none" },
  ".cm-panels": { backgroundColor: "hsl(var(--card))", color: "hsl(var(--foreground))" },
  ".cm-tooltip": { backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" },
  ".cm-foldPlaceholder": { backgroundColor: "hsl(var(--muted))", border: "none", color: "hsl(var(--muted-foreground))" },
});

const highlight = HighlightStyle.define([
  { tag: [t.propertyName, t.definition(t.propertyName)], color: "hsl(var(--primary))" },
  { tag: [t.string, t.special(t.string), t.content], color: "hsl(var(--foreground) / 0.85)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "hsl(var(--warning))" },
  { tag: [t.comment, t.lineComment], color: "hsl(var(--muted-foreground))", fontStyle: "italic" },
  { tag: [t.meta, t.punctuation, t.separator, t.squareBracket, t.brace], color: "hsl(var(--muted-foreground))" },
  { tag: [t.typeName, t.labelName], color: "hsl(var(--destructive))" },
]);

export interface YamlEditorProps {
  value: string;
  onChange?: (value: string) => void;
  /** where the cursor is, for field documentation */
  onLocate?: (loc: YamlLocation) => void;
  readOnly?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
}

/** A YAML editor: highlighting, line numbers, folding, search, bracket matching and Tab to indent. */
export default function YamlEditor({ value, onChange, onLocate, readOnly, autoFocus, ariaLabel = "YAML" }: YamlEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // the latest callbacks, without rebuilding the editor
  const cb = useRef({ onChange, onLocate });
  cb.current = { onChange, onLocate };

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          indentUnit.of("  "),
          EditorState.tabSize.of(2),
          yaml(),
          theme,
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          EditorState.readOnly.of(!!readOnly),
          EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange?.(u.state.doc.toString());
            if (u.docChanged || u.selectionSet) cb.current.onLocate?.(locate(u.state.doc.toString(), u.state.selection.main.head));
          }),
        ],
      }),
    });
    view.current = v;
    if (autoFocus) v.focus();
    return () => {
      v.destroy();
      view.current = null;
    };
    // the editor is built once; value changes from outside are synced below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  // replace the text when the parent loads a new document (not on every keystroke the editor itself made)
  useEffect(() => {
    const v = view.current;
    if (v && value !== v.state.doc.toString()) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}
