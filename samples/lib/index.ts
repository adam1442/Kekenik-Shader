/**
 * Shared subgraph library (docs/SAMPLES.md §Library). Naming: `ks_<topic>_<kind>` ids, display names without the prefix.
 * Every port has a tooltip + default; every kit has a group + explanatory note. Add new kits here so Browser / tests find them.
 */
import type { SubgraphDef } from "@/core";
import { fresnelKit } from "./fresnel";
import { noiseStack } from "./noise";
import { softDissolve } from "./dissolve";
import { paletteRamp } from "./palette";
import { outlineKit, pixelSnap } from "./sprite";
import { heightBlend, triplanar } from "./triplanar";
import { flowSample } from "./flow";
import { depthIntersect, gerstnerWave } from "./water";
import { toonLight } from "./toon";
import { anisoSpec, colorRamp3, heightBlend4, thinFilm } from "./fx";

export const LIBRARY: ReadonlyArray<() => SubgraphDef> = [fresnelKit, noiseStack, softDissolve, paletteRamp, pixelSnap, outlineKit, triplanar, heightBlend, flowSample, gerstnerWave, depthIntersect, toonLight, colorRamp3, thinFilm, anisoSpec, heightBlend4];
export { fresnelKit,  softDissolve, paletteRamp, pixelSnap, outlineKit, triplanar, heightBlend, flowSample, gerstnerWave, depthIntersect, toonLight, colorRamp3, thinFilm, anisoSpec, heightBlend4 };
