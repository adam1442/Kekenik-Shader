import type { SampleModule } from "../build/emit";
import { fireSample } from "./fire";
import { smokeSample } from "./smoke";
import { energyBeamSample } from "./beam";
import { shockwaveSample } from "./shockwave";
import { glowOrbSample } from "./orb";
import { shieldSample } from "./shield";
import { magicCircleSample } from "./magic";
import { portalSample } from "./portal";
import { lightningSample } from "./lightning";
import { dissolveTrailSample } from "./trail";
import { explosionSample } from "./explosion";

/** VFX / particle samples (display order). */
export const SAMPLE_MODULES_VFX: readonly SampleModule[] = [fireSample, smokeSample, energyBeamSample, shockwaveSample, glowOrbSample, shieldSample, magicCircleSample, portalSample, lightningSample, dissolveTrailSample, explosionSample];
