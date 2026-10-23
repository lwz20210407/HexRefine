# Existing K macro-field refinement

```text
npm run build
node scripts/refine-ogrid-macro-field.mjs request.json NEW_OUTPUT_DIRECTORY
```

Input is version1, `kind:"ogrid-macro-field"`, with `meshFile` and `options` from
`refineOgridMacroField`. Paths resolve relative to the request file, not the cwd.
The saved output `request.json` rebases its input path so it can actually be replayed.
The parent destination must already exist. Existing destinations/symlinks are refused
before expensive computation. Request/source limits are16MiB/256MiB.
Before writing, actual payload bytes plus a1GiB disk reserve are required. The mesh
is written as `mesh.k.partial` and renamed only after the sidecars are complete.
Unexpected I/O failure can leave owned partial diagnostics, never a published
`mesh.k` success. Existing output directories still require explicit user handling.

## Do Not Confuse Two Element-ID Spaces

`targetIdSpace` defaults `external`: `options.targets[].elementId` names the actual
EID in the source K. Unknown IDs fail rather than being interpreted as array indices.
For legacy mesh/region lists that use imported cell order, explicitly specify
`targetIdSpace:"ordinal"`. The batch TC4 region lists use that latter convention;
the source specimen EIDs start at136, not1. No namespace is guessed from values.

```json
{
  "schemaVersion": 1,
  "kind": "ogrid-macro-field",
  "meshFile": "specimen.k",
  "targetIdSpace": "external",
  "options": {
    "axis": 2,
    "targets": [{"elementId": 144, "level": 2}],
    "shellLayers": 2,
    "maxAdditionalShellParents": 270,
    "transitionGeometry": "conservative-face-flux",
    "minimumCornerScaledJacobian": 0.15,
    "minimumTransitionToCoreEdgeRatio": 1
  }
}
```

The one-ID example illustrates the schema, not a promise that any isolated parent
has a compatible shell. Use the complete intended ROI, not a guessed geometric box.

Report `targetIdSpace` describes the input request; `requestedTargets` retains it.
Report `targets` uses `nativeTargetIdSpace:"ordinal"`. Native parent/node/interface
diagnostics also use imported indices. `lineage.json` maps those indices to source
and output external IDs. Error responses additionally provide the original K
`sourceExternalParentIds` and `sourceExternalFaceNodeIds` when available.

Optional `options.diagnosticSearchBudget` enables a bounded, failure-only
shared-face witness probe. Errors include structured `diagnostics`; no relaxed
candidate is published. `options.axialStationSearch:"extended"` explicitly adds25
monotone geometry profiles, without changing the global quality gate or protected
source/core/far-field contracts. `protected-region-quality` diagnostics identify
inherited low-quality source/core cells separately from a passing shell.

## Preserved Semantics

- Input is a single-PID, eight-distinct-node mesh-only K. KEYWORD/TITLE/NODE/SOLID/END
  are recognized. Other solver/beam/shell cards, active NODE constraint flags,
  mixed PIDs and unsupported multiline solid records are refused, not dropped.
- Original node IDs and positions are retained. Added nodes receive fresh IDs above
  the original maximum. Untouched far-field cells retain their actual external EIDs
  and connectivity. Every child of a replaced parent gets a fresh EID; no parent EID
  is ambiguously reused as one child. PID is inherited, not reset to1.
- Existing compact16-column coordinate formatting is reused. Complete generated K
  connectivity, external identities and scale-relative coordinate accuracy are
  re-read before publishing. No materials, sets, BCs, contacts or history state are
  inferred/migrated. Geometric sets are not solver boundary conditions.

Outputs: `mesh.k`, `lineage.json`, `report.json`, reusable `request.json`. No output
directory is created after unsupported topology/quality/namespace failure. The
caller retains the original source as the replay dependency; its SHA256 is recorded.
This is the Node backend, not an extension of the currently concentric-only Python
job adapter or a new GUI control. Existing GUI viewers can inspect the resulting
geometry, but ordinary re-export is not claimed to retain these external IDs.

Tests cover noncontiguous nodes/EIDs, inherited PID7, both explicit ID spaces,
unknown target IDs, complete readback, saved-request replay, overwrite refusal and
solver-card refusal. See [native contracts](OGRID_NATIVE_MACRO_FIELD.md).
