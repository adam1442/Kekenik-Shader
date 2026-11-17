/** Lightweight markdown for comments: `# h1`, `## h2`, `### h3`, `- item`, `---`, **bold**, *italic*, `code`, [text](url). No HTML is ever produced from user text. */
export type Inline = { t: "text" | "b" | "i" | "code" | "link"; text: string; href?: string };
export type Block = { type: "h1" | "h2" | "h3" | "li" | "p" | "hr" | "blank"; inlines: Inline[] };

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ t: "text", text: text.slice(last, i) });
    const tok = m[0];
    if (tok.startsWith("**")) out.push({ t: "b", text: tok.slice(2, -2) });
    else if (tok.startsWith("`")) out.push({ t: "code", text: tok.slice(1, -1) });
    else if (tok.startsWith("[")) {
      const k = tok.indexOf("](");
      const href = tok.slice(k + 2, -1);
      out.push(
        /^(https?:|mailto:)/i.test(href)
          ? { t: "link", text: tok.slice(1, k), href }
          : { t: "text", text: tok.slice(1, k) },
      );
    } else out.push({ t: "i", text: tok.slice(1, -1) });
    last = i + tok.length;
  }
  if (last < text.length) out.push({ t: "text", text: text.slice(last) });
  return out;
}

export function parseMarkdown(src: string): Block[] {
  return src.split(/\r?\n/).map((line): Block => {
    if (/^\s*$/.test(line)) return { type: "blank", inlines: [] };
    if (/^-{3,}\s*$/.test(line)) return { type: "hr", inlines: [] };
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) return { type: `h${h[1]!.length}` as "h1" | "h2" | "h3", inlines: parseInline(h[2]!) };
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) return { type: "li", inlines: parseInline(li[1]!) };
    return { type: "p", inlines: parseInline(line) };
  });
}
