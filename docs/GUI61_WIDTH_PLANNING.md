# Explicit GUI ring-width planning

The existing `concentric-circular-solid` menu now contains four numerical criteria:
minimum cornerSJ, maximum transition longest/shortest-edge ratio, minimum
transition/core-edge ratio and minimum regular/core-edge ratio. Defaults0.2/6/1/1
are editable screening settings, not universal engineering acceptance.

1. Enter or import a valid concentric draft. Incompatible seeds are explicitly
   refused; the separate seed-advisor CLI can propose count changes first.
2. Calculate a width proposal. The draft and its existing generated mesh remain
   unchanged. HTTP uses an isolated native worker; offline uses the embedded kernel.
3. Review every ring's old/new outer radius and width, total cells and audited metrics.
   Discard leaves the draft intact. Changing any mesh parameter or criterion invalidates
   the proposal. Switching menus/importing/resetting also invalidates it.
4. Apply explicitly. Only outer radii and a nondecreasing minimumSJ gate may change.
   Applying invalidates the old K snapshot. Generate again to preview/export a new K.

`planGui61ConcentricWidths` and `applyGui61ConcentricWidthPlan` expose the same
workflow to callers. Applying against a different source draft fails as stale. Frozen
geometry/seed/radial-policy changes and a decreased minimumSJ gate are refused.
The planner retains its finite budgets, fixed core, fixed inner radii and no-optimality
claim. A failure does not change the draft or manufacture a successful proposal.

Download the full planning report before applying/discarding. Normal mesh parameter
archives retain the resolved generation parameters and reproduce their K; they do not
silently certify all width criteria on future edits. The planning report is a separate
artifact. Large requests can still be planned within motif budgets and exported for
the streaming CLI; the browser's200000-full-cell preview cap remains unchanged.

The Python job cancellation API is independent. Browser width planning is not yet
interruptible; offline computation can block its main thread during a native audit.
No claim is made that a cancel button or production job queue is integrated in the GUI.

Verification: GUI proposal API tests, HTTP worker/standalone/mobile interaction,
discard/apply/failure checks, actual K download, parameter archive replay and byte
comparison. See `THREE_NATIVE_MODULES_VALIDATION.md` for evidence.
