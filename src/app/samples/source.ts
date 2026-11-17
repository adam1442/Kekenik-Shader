import type { SampleIndex } from "@/core";

/**
 * Sample files bundled into the app (`import.meta.glob` over `public/samples`), so the single-file build
 * works offline and from `file://` with zero network requests.
 */
export interface SampleSource {
  index(): Promise<SampleIndex>;
  text(file: string): Promise<string>;
}

type Loader = () => Promise<string>;
const BUNDLED = import.meta.glob("/public/samples/*", { query: "?raw", import: "default" }) as Record<string, Loader>;

/** Samples compiled into the bundle: needs no server, no relative URL, works from `file://` and from a single-file host. */
function bundledSampleSource(files: Record<string, Loader> = BUNDLED): SampleSource {
  const find = (file: string): Loader => {
    const l = files[`/public/samples/${file}`];
    if (!l) throw new Error(`sample file "${file}" is not bundled (have: ${Object.keys(files).map((k) => k.split("/").pop()).join(", ") || "none"})`);
    return l;
  };
  return { index: async () => JSON.parse(await find("index.json")()) as SampleIndex, text: (file) => find(file)() };
}

const source: SampleSource = bundledSampleSource();
export const getSampleSource = (): SampleSource => source;

const texts = new Map<string, Promise<string>>();
/** Text of a sample file (cached per source file; a failed load is not cached). */
export function sampleText(file: string): Promise<string> {
  let p = texts.get(file);
  if (!p) {
    p = source.text(file);
    texts.set(file, p);
    p.catch(() => texts.delete(file));
  }
  return p;
}
