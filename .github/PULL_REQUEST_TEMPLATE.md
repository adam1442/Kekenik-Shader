## Summary

<!-- Briefly describe what this PR changes and why. -->

## Related Issue

<!-- Link any related issue, e.g. Fixes #123 -->

## Checklist

- [ ] `npm run typecheck` passes with 0 errors
- [ ] `npm run lint` passes with 0 errors
- [ ] `npm run build` succeeds cleanly
- [ ] Core purity maintained (`src/core/**` has no DOM/React/Three/UI imports)
- [ ] If production dependencies changed, `node scripts/gen-licenses.mjs` was run (and no copyleft dependencies were added)
- [ ] If engine export code changed, static validators and [`docs/EXPORT_TARGETS.md`](docs/EXPORT_TARGETS.md) were updated as appropriate
