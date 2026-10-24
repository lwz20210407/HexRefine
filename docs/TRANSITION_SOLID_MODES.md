# Native Solid Transition Domains

## Scope and Provenance

Planar-solid, radial-cylinder and axial-cylinder generators produce H8 volume
meshes, not zero-thickness solids or surface-only demonstrations. Each supports
2:1/3:1 chains and optional adjacent regular solid regions. Runtime does not
require Abaqus, MATLAB, TrueGrid or third-party Python modules.

The implementation reuses HexRefine's existing Owen/Q1 templates. No published
non-commercial TransitionMesh Python file is redistributed or imported.
The comparison target is IY724/TransitionMesh v1.0 at
`38850881db802e6d49e34905e81430cdbbc78107`.

## Request Contract

Use `generateTransitionMeshRequest` or the existing CLI:

```sh
node scripts/generate-transition-band.mjs examples/input/solid-transition-regular-regions.json NEW_OUTPUT_DIRECTORY
```

Optional `regularRegions` is supported for solid `planar`, `annular` and `axial`
requests. Planar/annular require `extrusion`; axial already has radial solid
layers. Each side accepts `{width, layers}`: positive finite width and 1–1000
integer layers.

| Mode | Regular-region width |
| --- | --- |
| planar | Outward distance normal to the fine/coarse edge in the rotated XY frame |
| annular | Radial extension away from the fine/coarse circle |
| axial | Outward axial distance respecting `fineEnd`, normalized axis and origin |

Existing mode dimensions describe the **band**, not the extended whole domain:
a 12-unit axial band plus 4 units on each side has total length 20. A radial
extension must retain a positive inner radius; creating a solid circular core
is not achieved by collapsing annular cells.

Interface nodes are shared by ID, with no coordinate-tolerance merge. Every
transition node/cell retains its prefix, coordinate and connectivity. Output
sets distinguish `fine-regular`, `coarse-regular` and `stage_N`, rather than
relabeling coarse cells as core. `fine_interface`/`coarse_interface` remain
internal; `fine_external`/`coarse_external` name the new exterior ends.

Preflight bounds cover nodes and cells. Validation checks the exact expected
exterior face set, positive corner/eight-Gauss-point Jacobians, volume and
boundary-integral agreement, duplicate cells and hanging interfaces. Formatted
K/INP readback also verifies Jacobians/volume, connectivity and precision.

## Declared Radial Cuts

`seamAnglesDegrees` lists cuts in the local angular frame. Each must align with
a whole motif boundary at **every** stage, not merely an interface node.
Already-existing aligned planes are accepted even when no new plane is needed.
Unsupported phases fail explicitly; count suggestions preserve angles/ratios.

This conservative motif contract is not a general mathematical impossibility
claim. Returned `geometryChecked:false` and `existingMeshStitched:false` are
intentional: this check does not import CAD or install cells in an old mesh.

## Actual Abaqus Solid Reproductions

On 2026-10-24 the published v1.0 code ran in licensed Abaqus/CAE 2020. The author
supports 2024+; the private replay recorded Python-version shims only: print
function, math functions, sketch-reference lifetime and JSON log I/O. The
installed plugin and original archive were not modified. Plate fixtures
explicitly propagated generated source-face partitions through the solid to
provide required sweepable Cells; that preparation is not credited to the plugin.

The matrix covers all three solid paths, ratios 2/3, stages 1/2: **12 C3D8R
cases**. Four more cylinder cases test automatic regular neighbors; three
display-scale cases use the visible author-image fine counts (plate 60,
cylinders 180). Total: **19 actual source solid cases**.

| Representative case | Abaqus H8 | Native H8 | Native minimum corner SJ |
| --- | ---: | ---: | ---: |
| Planar, 60 fine segments, 3:1 band, 5 thickness layers | 400 | 400 | 0.371391 |
| Radial, 180 fine segments, regular inner/outer regions | 3240 | 3240 | 0.538991 |
| Axial, 180 fine segments, regular ends | 5220 | 5220 | 0.463771 |
| Axial 2:1, 48 fine segments, band only | 95 | 72 | 0.212551 |
| Axial 2:1, 48 fine segments, regular ends | 336 | 288 | 0.212551 |

Four controlled plates match source node coordinates and cell node sets after
the declared local-frame reflection. Four controlled radial meshes match after
phase/reflection alignment, with maximum coordinate difference below 9e-7,
consistent with Abaqus coordinate precision. This comparison tolerance is not
used for generator node merging.

Axial layouts are **alternative topologies**, especially 2:1: the Abaqus sweep
mesher can add cells. Counts alone do not establish equivalence. Each result is
separately audited for full interface count chains, H8 connectivity, positive
Jacobians, no unexpected internal free faces, closed manifold exterior and
discrete boundary/element volume agreement. Independent NumPy/PyDYNA audits
cover **39 K files: 19 source, 20 native**, including one extra full-domain
plate. No acceptance threshold was relaxed.

The author pictures lack complete numeric decks. Display-scale cases reproduce
their mode/direction, regular/transition organization and visible fine counts,
not undocumented exact dimensions. Circular discretization error is reported
separately from volume conservation. This is not solver/engineering certification.

## GUI and Remaining Limits

The dialog exposes radial cut angles and independent fine/coarse regular-region
toggles, widths and layers. CLI, worker and offline GUI use the same request.
A browser trial/apply of an extended two-level axial solid produced 608 H8,
minimum SJ 0.635287, with no browser errors. Trial invalidation and replay retain
the new request fields.

This does not finish arbitrary imported-mesh boundary matching, freeform curved
sweeps, general O-grid corner macros, weakly balanced edge/corner installation
or every GUI_tg combination. Regular-region counts are explicit; automatically
inferring them from arbitrary CAD neighbors remains separate. A reproducible
upstream audit issue is reported at <https://github.com/IY724/TransitionMesh/issues/1>.

Private evidence, K files, author images, comparison JSON and actual LSPP
screenshots remain in the dated `20261024-transitionmesh-solid-validation`
workspace directory, not as third-party source inside this repository.
