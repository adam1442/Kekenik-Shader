import type { SourceRef } from "../../ir/types";

/** One generated line that originated from a graph node (1-based line numbers). */
export interface LineEntry {
  line: number;
  nodeId: string;
  portId?: string;
  scope?: string;
}

/** Indentation-aware text writer that also records a source line table (generated line → graph node). */
export class CodeWriter {
  private lines: string[] = [];
  private depth = 0;
  readonly table: LineEntry[] = [];

  constructor(private readonly unit = "    ") {}

  /** Append a line (empty text → blank line without trailing spaces). `ref` is recorded in the line table. */
  line(text = "", ref?: SourceRef): this {
    this.lines.push(text === "" ? "" : this.unit.repeat(this.depth) + text);
    if (ref) {
      const e: LineEntry = { line: this.lines.length, nodeId: ref.nodeId };
      if (ref.portId !== undefined) e.portId = ref.portId;
      if (ref.scope !== undefined) e.scope = ref.scope;
      this.table.push(e);
    }
    return this;
  }

  /** Append several raw lines (already formatted) at the current indentation. */
  raw(text: string): this {
    for (const l of text.split("\n")) this.line(l);
    return this;
  }

  /** Append another writer's lines (its line table is shifted to the new positions). */
  append(other: CodeWriter): this {
    const offset = this.lines.length;
    for (const l of other.lines) this.lines.push(l === "" ? "" : this.unit.repeat(this.depth) + l);
    for (const e of other.table) this.table.push({ ...e, line: e.line + offset });
    return this;
  }

  blank(): this {
    if (this.lines.length > 0 && this.lines[this.lines.length - 1] !== "") this.lines.push("");
    return this;
  }

  indent(): this {
    this.depth++;
    return this;
  }

  dedent(): this {
    this.depth = Math.max(0, this.depth - 1);
    return this;
  }

  /** `open` … body … `close` with one extra indentation level inside. */
  block(open: string, body: () => void, close = "}"): this {
    this.line(open);
    this.indent();
    body();
    this.dedent();
    return this.line(close);
  }

  get lineCount(): number {
    return this.lines.length;
  }

  toString(): string {
    return this.lines.join("\n").replace(/\n+$/, "") + "\n";
  }
}
