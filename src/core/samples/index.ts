import { makeProperty } from "../properties/model";
import type { Graph } from "../graph/types";
import { SampleBuilder } from "./builder";

export interface SampleGraph {
  id: string;
  name: string;
  description: string;
  /** Emit options for the GLSL backend (e.g. the interpolation hint). */
  emitOptions?: { interpolate?: string[] };
  build: () => Graph;
}


/** 1. UV gradient with a pulsing blue channel: UV, Time, Remap, Split, Combine. */
function uvPulse(): Graph {
  return new SampleBuilder({ name: "UV Gradient Pulse", profileId: "generic" })
    .n("master", "masterOutput", {}, 5)
    .n("uv", "uv", {}, 0, 0).n("time", "time", {}, 0, 1)
    .n("split", "split", {}, 1, 0)
    .n("pulse", "remap", { label: "Pulse", values: { inMin: -1, inMax: 1, outMin: 0.25, outMax: 1 } }, 2, 1)
    .n("rgb", "combine", { label: "Gradient", values: { a: 1 } }, 3, 0)
    .w("uv.out", "split.in").w("time.sine", "pulse.in")
    .w("split.r", "rgb.r").w("split.g", "rgb.g").w("pulse.out", "rgb.b")
    .w("rgb.rgba", "master.Color")
    .build();
}

/** 2. Tinted texture with alpha clip: exposed Color / Texture / Float properties. */
function tintedTexture(): Graph {
  const props = [
    makeProperty("tint", "Tint", "color4", { default: [1, 0.62, 0.25, 1], category: "Surface" }),
    makeProperty("albedo", "Albedo", "texture2D", { textureDefault: "white", category: "Surface" }),
    makeProperty("cutoff", "Alpha Cutoff", "float", { default: 0.1, min: 0, max: 1, slider: true, category: "Surface" }),
  ];
  return new SampleBuilder({ name: "Tinted Texture (Alpha Clip)", profileId: "generic", properties: props })
    .n("master", "masterOutput", {}, 4)
    .n("pTint", "property", { params: { property: "tint" } }, 0, 0).n("pTex", "property", { params: { property: "albedo" } }, 0, 1)
    .n("pCut", "property", { params: { property: "cutoff" } }, 0, 2)
    .n("tex", "sampleTexture2D", {}, 1, 1)
    .n("tinted", "multiply", { label: "Tinted" }, 2, 0)
    .w("pTex.out", "tex.tex").w("tex.rgba", "tinted.a").w("pTint.out", "tinted.b")
    .w("tinted.out", "master.Color").w("pCut.out", "master.AlphaClipThreshold")
    .build();
}

/** 3. Fresnel rim lighting: Normal, View Direction, Dot, Saturate, One Minus, Power, Lerp. */
function fresnelRim(): Graph {
  return new SampleBuilder({ name: "Fresnel Rim", profileId: "generic" })
    .n("master", "masterOutput", {}, 7)
    .n("normal", "normal", { params: { space: "world" } }, 0, 0).n("view", "viewDirection", { params: { space: "world" } }, 0, 1)
    .n("ndv", "dot", { label: "N·V" }, 1, 0).n("sat", "saturate", {}, 2, 0).n("inv", "oneMinus", {}, 3, 0)
    .n("rim", "power", { label: "Rim", values: { b: 3 } }, 4, 0)
    .n("base", "color", { label: "Base", params: { value: [0.05, 0.08, 0.2, 1] } }, 4, 1)
    .n("glow", "color", { label: "Glow", params: { value: [0.3, 0.9, 1, 1] } }, 4, 2)
    .n("mix", "lerp", { label: "Rim Mix" }, 5, 0)
    .w("normal.out", "ndv.a").w("view.out", "ndv.b").w("ndv.out", "sat.in").w("sat.out", "inv.in").w("inv.out", "rim.a")
    .w("base.out", "mix.a").w("glow.out", "mix.b").w("rim.out", "mix.t").w("mix.out", "master.Color")
    .build();
}

/** 4. Vertex wave (VFX style): vertex offset along the normal, vertex-color tint, optional "evaluate in vertex" hint. */
function vertexWave(): Graph {
  const props = [
    makeProperty("freq", "Frequency", "float", { default: 6, min: 0, max: 20, slider: true }),
    makeProperty("amp", "Amplitude", "float", { default: 0.08, min: 0, max: 0.5, slider: true }),
  ];
  return new SampleBuilder({ name: "Vertex Wave", profileId: "generic", properties: props })
    .n("master", "masterOutput", {}, 8)
    .n("pos", "position", { params: { space: "object" } }, 0, 0).n("time", "time", {}, 0, 1)
    .n("pFreq", "property", { params: { property: "freq" } }, 0, 2).n("pAmp", "property", { params: { property: "amp" } }, 0, 3)
    .n("sx", "split", {}, 1, 0)
    .n("phase", "multiply", { label: "Phase" }, 2, 0).n("shift", "add", {}, 3, 0)
    .n("wave", "sin", { label: "Wave" }, 4, 0)
    .n("amount", "multiply", { label: "Amount" }, 5, 0)
    .n("nrm", "normal", { params: { space: "object" } }, 5, 1)
    .n("offset", "multiply", { label: "Offset" }, 6, 0)
    .n("wave01", "remap", { label: "Wave 0-1" }, 5, 2)
    .n("cA", "color", { label: "Low", params: { value: [0.1, 0.2, 0.8, 1] } }, 5, 3).n("cB", "color", { label: "High", params: { value: [1, 0.55, 0.15, 1] } }, 5, 4)
    .n("shade", "lerp", { label: "Shade" }, 6, 3)
    .n("vcol", "vertexColor", {}, 6, 4)
    .n("final", "multiply", { label: "Final" }, 7, 3)
    .w("pos.out", "sx.in").w("sx.r", "phase.a").w("pFreq.out", "phase.b").w("phase.out", "shift.a").w("time.time", "shift.b")
    .w("shift.out", "wave.in").w("wave.out", "amount.a").w("pAmp.out", "amount.b")
    .w("nrm.out", "offset.a").w("amount.out", "offset.b").w("offset.out", "master.VertexOffset")
    .w("wave.out", "wave01.in").w("cA.out", "shade.a").w("cB.out", "shade.b").w("wave01.out", "shade.t")
    .w("shade.out", "final.a").w("vcol.rgba", "final.b").w("final.out", "master.Color")
    .build();
}

export const SAMPLE_GRAPHS: readonly SampleGraph[] = [
  { id: "uv-pulse", name: "UV Gradient Pulse", description: "UV → color with a pulsing blue channel (Time, Remap, Split, Combine).", build: uvPulse },
  { id: "tinted-texture", name: "Tinted Texture (Alpha Clip)", description: "Exposed Tint / Albedo / Cutoff properties, texture sampling and alpha clip.", build: tintedTexture },
  { id: "fresnel-rim", name: "Fresnel Rim", description: "Normal · View Direction rim lighting (3D).", build: fresnelRim },
  { id: "vertex-wave", name: "Vertex Wave", description: "Vertex offset along the normal + vertex-color tint; the wave is evaluated per vertex and interpolated.", emitOptions: { interpolate: ["wave01"] }, build: vertexWave },
];
