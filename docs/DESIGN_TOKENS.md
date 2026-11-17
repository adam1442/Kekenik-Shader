# Design Tokens (Kekenik Shader)

Source of truth: `src/styles/tokens.css` and `src/styles/controls.css`.

| Area | Tokens / Values |
|---|---|
| Row heights | `--kk-row-h: 24px` (regular), `--kk-row-h-compact: 20px` (graph-node inline editors) — defined in `styles/controls.css` |
| Field surface | `--kk-field-bg` (= surface-2), `--kk-field-bg-hover` (= surface-3), 1 px `--kk-border`, hover `--kk-border-strong`, radius `--kk-radius-sm` (5 px) |
| Accent use | fills (`--kk-accent-soft`), focus (`--kk-shadow-glow`), selection, modified-dot — nothing else |
| States | invalid `--kk-danger(-soft)`, read-only dashed border, disabled 50 % opacity, mixed "—" |
| Numeric type | JetBrains Mono, `tabular-nums`, `--kk-text-sm` (regular) / `--kk-text-xs` (compact) |
| Motion | fills ≤ 60 ms linear, hover/focus 120 ms (`--kk-dur-fast`), popover 120 ms; all disabled under `prefers-reduced-motion` |
| Popovers | `--kk-surface-3`, `--kk-shadow-3`, z-index `--kk-z-dropdown` (above `--kk-z-modal`, below `--kk-z-menu`) |
| Axis stripes | X `#f06a6a`, Y `#6fd36f`, Z `#6a9cf0`, W `#bdbdbd` (vector fields) |
| Checkerboard | `.kk-checker` (alpha previews) |
