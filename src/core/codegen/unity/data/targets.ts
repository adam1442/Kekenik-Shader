/**
 * Unity / URP targets as DATA. Version differences are never `if`-chains in templates: templates ask the `UnityTarget`.
 * Source: brief §0. `verified` = confirmed against official documentation when the brief was written ([V]);
 * otherwise the value is from the author's knowledge of URP sources ([K], `unverified-by-doc`) and is covered by the manual checklist.
 */
export interface UnityTarget {
  /** Stable id used in graph settings (`unityVersion`). */
  id: string;
  /** Unity editor version label. */
  unity: string;
  /** URP package version. */
  urp: string;
  label: string;
  /** Keyword enabling the clustered / Forward+ light loop. */
  forwardPlusKeyword: "_FORWARD_PLUS" | "_CLUSTER_LIGHT_LOOP";
  /** Soft-shadow quality keywords (`_SHADOWS_SOFT_LOW/MEDIUM/HIGH`) exist. */
  softShadowQuality: boolean;
  /** URP ships `MotionVectorsCommon.hlsl` (Unity 6 / URP 17+). 2022.3 has no object-motion-vector include → the pass is not generated there. */
  motionVectors: boolean;
  default?: boolean;
  verified: { forwardPlus: boolean; softShadow: boolean };
}

export const UNITY_TARGETS: readonly UnityTarget[] = [
  {
    id: "2022.3",
    unity: "2022.3 LTS",
    urp: "14.0.x",
    label: "Unity 2022.3 LTS (URP 14)",
    forwardPlusKeyword: "_FORWARD_PLUS",
    softShadowQuality: false,
    motionVectors: false,
    verified: { forwardPlus: false, softShadow: false },
  },
  {
    id: "6000.0",
    unity: "6000.0 (Unity 6.0)",
    urp: "17.0.x",
    label: "Unity 6.0 (URP 17.0)",
    forwardPlusKeyword: "_FORWARD_PLUS",
    softShadowQuality: true,
    motionVectors: true,
    verified: { forwardPlus: true, softShadow: true },
  },
  {
    id: "6000.1",
    unity: "6000.1 (Unity 6.1)",
    urp: "17.1.x",
    label: "Unity 6.1 (URP 17.1)",
    forwardPlusKeyword: "_CLUSTER_LIGHT_LOOP",
    softShadowQuality: true,
    motionVectors: true,
    verified: { forwardPlus: true, softShadow: true },
  },
  {
    id: "6000.2",
    unity: "6000.2 (Unity 6.2)",
    urp: "17.2.x",
    label: "Unity 6.2 (URP 17.2)",
    forwardPlusKeyword: "_CLUSTER_LIGHT_LOOP",
    softShadowQuality: true,
    motionVectors: true,
    verified: { forwardPlus: true, softShadow: true },
  },
  {
    id: "6000.3",
    unity: "6000.3 LTS (Unity 6.3)",
    urp: "17.3.x",
    label: "Unity 6.3 LTS (URP 17.3)",
    forwardPlusKeyword: "_CLUSTER_LIGHT_LOOP",
    softShadowQuality: true,
    motionVectors: true,
    default: true,
    verified: { forwardPlus: true, softShadow: true },
  },
];

const DEFAULT_UNITY_TARGET: UnityTarget = UNITY_TARGETS.find((t) => t.default)!;

export const unityTargetById = (id: unknown): UnityTarget =>
  UNITY_TARGETS.find((t) => t.id === id) ?? DEFAULT_UNITY_TARGET;
