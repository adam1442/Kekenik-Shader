import type { SampleModule } from "../build/emit";
import { outlineGlowSample } from "./outline";
import { spriteDissolveSample } from "./dissolve";
import { paletteSwapSample } from "./palette";
import { hitFlashSample } from "./hitflash";
import { shineSweepSample } from "./shine";
import { pixelateSample } from "./pixel";
import { crtSample } from "./crt";
import { glitchSample } from "./glitch";
import { wavyShakeSample } from "./wavy";
import { silhouetteShadowSample } from "./shadow";
import { waterReflectionSample } from "./water";
import { normalLitSample } from "./normallit";

/** 2D / Sprite samples (display order). */
export const SAMPLE_MODULES_2D: readonly SampleModule[] = [outlineGlowSample, spriteDissolveSample, paletteSwapSample, hitFlashSample, shineSweepSample, pixelateSample, crtSample, glitchSample, wavyShakeSample, silhouetteShadowSample, waterReflectionSample, normalLitSample];
