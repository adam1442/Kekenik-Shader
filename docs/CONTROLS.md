# Kekenik Shader — Controls Library (`@/ui/controls`)

**Rule:** every value-editing UI (numbers, sliders, vectors, colors, gradients, curves, levels, dropdowns, toggles, textures, text…) uses this library (`src/ui/controls/**`). Pure value math lives in `src/core/values/**` (no DOM).

## Event Contract (All Controls)

| Prop | Meaning |
|---|---|
| `value` | controlled value |
| `onChange(v)` | **live** — fires continuously while dragging / typing steps |
| `onCommit(v)` | **exactly once per gesture** (drag end, Enter, blur, one key press, one wheel burst, one paste/reset) — hook undo transactions here |
| `onCancel()` | Esc during a gesture: the control first restores the pre-gesture value via `onChange`, then calls `onCancel`; no commit |
| `defaultValue` | modified-dot + Reset (double-click the label of a `ControlField`/`PropertyRow`, or context menu) |
| `disabled` / `readOnly` | inert; `readOnly` stays focusable/copyable |
| `mixed` | multi-selection with differing values (shows "—"; the first edit overwrites). Vec: `mixed: boolean[]` per component |
| `invalid` + `message` | red state + tooltip/helper text |
| `density` | `'regular'` (row 24 px) or `'compact'` (20 px, graph-node inline editors) |
| `label`, `tooltip`, `aria-label`, `className` | standard field metadata |

Text controls: live `onChange` may carry an invalid draft; `onCommit` never does (invalid drafts revert on blur). Text direction is `dir="auto"` (RTL-safe).

## Decision Matrix — Property Type ⇒ Control

| Kind | Inspector / Blackboard | Node Card (compact) |
|---|---|---|
| `float` (unbounded) | `NumberField` | `NumberField density="compact"` |
| `float` (min + max) | `Slider` | `Slider density="compact"` |
| `int` | `IntField` (or `Slider integer` with range) | `IntField density="compact"` |
| `bool` | `Toggle` / `Checkbox` | `Checkbox density="compact"` |
| `vec2` / `vec3` / `vec4` | `Vec2Field` / `Vec3Field` / `Vec4Field` | `Vec2Field` / `Vec3Field` / `Vec4Field` (`density="compact"`) |
| `color` / `color4` | `ColorField` (`alpha={false\|true}`, `hdr`) | `ColorField density="compact"` |
| `mat2` / `mat3` / `mat4` | `MatrixField` | `MatrixField density="compact"` |
| `texture2D` | `TextureSlot` | `TextureSlot density="compact"` |
| enum / choice | `Select` (≤ 7 options) or `Combobox` (> 7) or `SegmentedControl` (2–4 short options) | `Select density="compact"` |
| identifier / reference name | `IdentifierField` | — |
| gradient / curve / levels | `GradientField` / `CurveField` / `LevelsEditor` | inline preview swatch |
| angle / 2D offset / 3D direction | `AngleDial` / `XYPad` / `DirectionPicker` | compact variant |
