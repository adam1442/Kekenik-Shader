/** Clipboard with an in-memory fallback (the preview iframe may deny `navigator.clipboard`). */
let memory = "";

/**
 * How long the async clipboard API may take before we give up and use the in-memory copy. Browsers can leave `readText()` /
 * `writeText()` pending forever (permission prompt nobody answers, unfocused document in an embedded frame) — the context-menu
 * "Paste value" then never applied and the tests `1c.ctx.number-menu` timed out. Wall-clock timer (not rAF).
 */
const CLIPBOARD_TIMEOUT_MS = 1200;

/** `p` or `fallback` if it rejects or has not settled after {@link CLIPBOARD_TIMEOUT_MS}. */
function settleWithin<T>(p: Promise<T>, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), CLIPBOARD_TIMEOUT_MS);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

export function copyText(text: string): Promise<boolean> {
  memory = text;
  try {
    if (navigator.clipboard?.writeText)
      return settleWithin(
        navigator.clipboard.writeText(text).then(() => true),
        false,
      );
  } catch {
    /* denied */
  }
  return Promise.resolve(false);
}

/** Legacy fallback: select a hidden textarea and `execCommand("copy")` (works in iframes without clipboard permission). */
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Copy for user-facing "Copy" buttons: async clipboard API first, then the legacy selection fallback. */
export async function copyToClipboard(text: string): Promise<boolean> {
  return (await copyText(text)) || legacyCopy(text);
}

/** Reads the system clipboard when allowed, else the last text copied through {@link copyText}. */
export async function pasteText(): Promise<string> {
  try {
    if (navigator.clipboard?.readText) {
      const t = await settleWithin(navigator.clipboard.readText(), "");
      if (t) return t;
    }
  } catch {
    /* denied */
  }
  return memory;
}

export function lastCopied(): string {
  return memory;
}
