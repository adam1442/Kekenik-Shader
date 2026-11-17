import type { Diagnostic } from "../diagnostics";
import type { ParamValue } from "../graph/types";
import type { TypeTag } from "../types/semantics";
import type { ShaderType } from "../types/shaderType";

/**
 * Engine-agnostic target-profile framework . A profile is DATA: blocks, surface options, versions.
 * Generators live in `core/export` (dispatch by `engine`) so Godot is a pure addition.
 */
const CANONICAL_BLOCK_IDS = [
  "positionOS",
  "normalOS",
  "tangentOS",
  "baseColor",
  "alpha",
  "alphaClipThreshold",
  "normalTS",
  "metallic",
  "smoothness",
  "occlusion",
  "emission",
  "translucency",
  "thickness",
  "spriteMask",
] as const;
type CanonicalBlockId = (typeof CANONICAL_BLOCK_IDS)[number];
/** Engine-native blocks without a cross-engine meaning (Godot `SPECULAR`, `RIM`, `RIM_TINT`). Only profiles of that engine list them; switching to another engine drops them (`profile.block-dropped`). */
const NATIVE_BLOCK_IDS = ["specular", "rim", "rimTint", "lightDiffuse", "lightSpecular", "lightAlpha"] as const;
type NativeBlockId = (typeof NATIVE_BLOCK_IDS)[number];
export type BlockId = CanonicalBlockId | NativeBlockId;

export type EngineId = "unity-urp" | "godot";

/** `option === equals` (the option's default is used when the graph does not store it). */
export interface OptionPredicate {
  option: string;
  equals: ParamValue;
}

export interface BlockDef {
  id: BlockId;
  context: "vertex" | "fragment" | "light";
  label: string;
  type: ShaderType;
  required: boolean;
  defaultValue?: number | boolean | number[];
  /** The block is only evaluated while the predicate holds; its connection is kept (marked inactive) otherwise. */
  shownWhen?: OptionPredicate;
  tag?: TypeTag;
}

interface OptionValue {
  id: string;
  label: string;
  /** Shown as a badge + tooltip; the value stays selectable but is documented as not supported. */
  unsupportedReason?: string;
  /** Engine version gate : the value is only available from this target version on (UI disables it below). */
  since?: string;
}

export interface SurfaceOptionDef {
  id: string;
  label: string;
  kind: "enum" | "bool" | "float" | "int";
  values?: OptionValue[];
  default: ParamValue;
  min?: number;
  max?: number;
  /** Offers an "Expose in Material" companion switch (setting id `expose<Id>`). */
  exposable?: boolean;
  shownWhen?: OptionPredicate;
  tooltip?: string;
  group?: string;
}

export interface TargetVersion {
  id: string;
  label: string;
  default?: boolean;
}

/**
 * A material property the engine itself binds by name (Unity: the SpriteRenderer's sprite → `_MainTex`). Profile switching creates it when the
 * profile is entered and removes it again (when no node reads it) on leaving; the Blackboard keeps it undeletable and its reference fixed.
 */
export interface LockedPropertyDef {
  /** Stable property id of the auto-created property. */
  id: string;
  displayName: string;
  referenceName: string;
  type: "texture2D";
  textureDefault: "white" | "black" | "grey" | "bump";
  tooltip: string;
}

export interface TargetProfile {
  /** `unity.urp.unlit`, … Also the id of the derived registry `ProfileDef`. */
  id: string;
  engine: EngineId;
  label: string;
  family: "unlit" | "lit" | "sprite" | "vfx";
  blocks: BlockDef[];
  surfaceOptions: SurfaceOptionDef[];
  targetVersions: TargetVersion[];
  /** Set while code generation for the profile is not implemented: the UI disables the entry with this tooltip. */
  unavailableReason?: string;
  /** Engine-level graph settings this profile uses (shown in Graph Settings). */
  engineSettings: string[];
  /** Properties the engine binds by name (see `LockedPropertyDef`). */
  lockedProperties?: LockedPropertyDef[];
}

/** A problem found while switching profiles / generating / validating. Convertible to a graph `Diagnostic`-like row. */
export interface ProfileProblem {
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  nodeId?: string;
  line?: number;
  /** Manual-check id (docs/EXPORT_TARGETS.md) that covers an unverified item. */
  manual?: string;
}

export interface ExportFile {
  path: string;
  content: string;
  language: string;
}

export interface GenerateResult {
  files: ExportFile[];
  diagnostics: Diagnostic[];
  problems: ProfileProblem[];
}
