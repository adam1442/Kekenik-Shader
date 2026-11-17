import type { SampleMeta } from "@/core";
/** Typed identity: keeps every sample's metadata checked against `SampleMeta`. */
export const defineMeta = (m: SampleMeta): SampleMeta => m;
export const ALL_TARGETS: SampleMeta["targets"] = ["glsl", "hlsl", "wgsl", "unity", "godot"];
