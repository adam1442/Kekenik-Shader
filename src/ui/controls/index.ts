/**
 * Kekenik Shader — professional controls library. Public surface; see docs/CONTROLS.md.
 * ALL value-editing UI must come from here.
 */
export type { Density } from "./types";
export { getBridge, type ControlBridge } from "./bridge";
export { copyText, copyToClipboard, pasteText } from "./clipboard";
export { Popover } from "./Popover";
export { NumberField, IntField } from "./NumberField";
export { Slider } from "./Slider";
export { VecField, Vec3Field } from "./VecField";
export { ColorField } from "./ColorField";
export { Select, Combobox, type SelectOption } from "./Select";
export { SegmentedControl } from "./Segmented";
export { Toggle, Checkbox } from "./Switches";
export { TextField, TextArea, InlineEditableLabel, type TextFieldProps } from "./TextField";
export {
  TextureSlot,
  DEFAULT_TEXTURE,
  type TextureDefaultKind,
  type AssetProvider,
  type AssetInfo,
} from "./TextureSlot";
export { ShortcutRecorder } from "./ShortcutRecorder";
export { PropertyGrid, PropertySection, PropertyRow } from "./PropertyGrid";
