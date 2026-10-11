# Native Circular Target: Initial Subset

`generateCircularGradedMesh` is an experimental native TypeScript generator.
It supports a circular solid with a square central fine
region, independent X/Y reductions 2 or 3, and the circular source branch's
fixed Z reduction 3. It does not use MATLAB or TrueGrid at runtime.
Zero tilt supports quarter/half/full models. Nonzero tilt currently supports
half/full only; the verified comparison matrix uses +/-15 degrees.

```json
{
  "schemaVersion": 1,
  "kind": "circular-solid",
  "parameters": {
    "radius": 20,
    "thickness": 6,
    "coreHalfSize": 8,
    "fineSize": 1,
    "coarseSize": 2,
    "reductions": { "x": 2, "y": 3 },
    "modelFraction": "half"
  }
}
```

Run `node scripts/generate-graded-mesh.mjs request.json NEW_OUTPUT_DIRECTORY`.
The rectangular entry-point filename is retained as an alias. Both output
NODE + ELEMENT_SOLID only. The shared CLI uses an opt-in compact decimal/scientific
representation that retains as much precision as fits in each 16-column field,
then verifies read-back error against the mesh scale. Existing exporter calls
still default to their previous eight-decimal scientific notation.

## Evidence

The recovered circular callback was run in MATLAB and its generated TG files
were executed by TrueGrid for GUI fractions 1/2/3 at 3/3/3 and fraction 2 at
2/3/3. Native half 3/3/3 has 1784 nodes / 1404 hexes, half 2/3/3 has 1672 /
1304, and full 3/3/3 has 3391 / 2808, matching those reference counts. Native
regressions cover all four X/Y combinations and quarter/half/full geometry.

The outer boundary uses equal-angle nodes on the exact circle. Interior radial
coordinates are a transfinite interpolation. Native and TG interior node
placements and transition connectivity need not be identical: the initial
3/3/3 comparison had a maximum nearest-node difference about 0.17 at radius 20.
This is an independent valid topology, not a byte-identical replay. Core count,
core tensor grid, boundary radius, shared faces, far-field locality, volume and
Jacobian checks are separate acceptance conditions.

The half 3/3/3 example has minimum corner SJ about 0.207, positive Gauss-point
Jacobians, and no unexpected internal free faces. Discrete volume is conserved.
Its polygonal linear-Hex boundary volume differs from the analytic cylinder
volume by about 1.14%; this geometric approximation error is reported separately,
not mislabeled as a conservation failure or hidden in a merge tolerance.

**Fraction semantics:** actual recovered GUI `vi=1` and `vi=2` produce the same
half-disk mesh in the measured cases. Native enum `quarter` means a real quarter
disk (X>=0,Y>=0), `half` means Y>=0, and `full` means the complete disk. A native
quarter result carries a warning about the difference. Do not map the original
GUI's numeric fraction values uniformly across generators.

## Not Implemented Here

- Nonzero quarter-model tilt and exact
  replay of the source's angle-dependent outer block anchors.
- Thickness-off or arbitrary Z ratios: this source branch fixes the Z ratio at 3.
- Multiple transition bands, cylindrical shells, physical multilayers, or beams.

Unsupported options are rejected rather than ignored. The outer radial count
must be integral and leave at least two intervals, and the transition band must
fit within the radius. The allocation estimate is limited to two million cells.
The low-level marked-half-sweep primitive is used only with the closed marking
of this generated domain; it is not a general imported-mesh selection planner.

Local evidence: `temp/20261011-hexrefine-gui61-validation/circle_oracle` and
`circle_cli` under the authorized workspace. Recovered source remains outside
the repository.

## Tilt Mapping and Region-Specific Quality

Optional `angleDegrees` specifies a core shear, not rigid rotation. The core's
top-to-bottom displacement is `thickness * tan(angleDegrees)`. Outside the
square core, displacement tapers radially to zero on the fixed circle. The
topology and core tensor-refinement lineage are unchanged, then geometry,
corner SJ, Gauss Jacobians, conformity and discrete volume are re-audited.
Invalid angles, insufficient band room, and nonzero quarter tilt are rejected.

The original TG branch additionally moves outer block anchors along the
circle. This native mapping is an independent alternative, not a node-for-node
port. In the 16-case comparison at radius 20, thickness 6, core half-size 8,
fine size 1 and coarse size 2, the maximum nearest-reference node distance is
about 0.803. Core anchor displacement agrees to the TG writer precision
(maximum error 2.43e-6); native core anchors agree to numerical precision.

Half/full x X/Y reductions 2/3 x +/-15 degrees have original MATLAB-generated
TG, executed TG reference K, native K and independent region-quality audits:

| Region | Native minimum corner SJ across cases | TG reference |
| --- | --- | --- |
| Fine core | About 0.965926 | About 0.965925-0.965926 |
| Transition, identified by parent lineage | 0.178834-0.191078 | Not separately labeled without source lineage |
| Unrefined far field | 0.760249-0.765025 | Not separately labeled without source lineage |
| All outside-core cells | Minimum occurs in transition | 0.170366-0.188519 |

Every native case's minimum is no worse than its corresponding TG minimum.
For this validated matrix, below-0.2 values are outside the fine core and are
accepted with a retained warning, not an export blocker. No global tolerance
or threshold was loosened. Nonpositive sampled Jacobians, unexpected internal
free faces and nonconformity remain failures. This scoped acceptance is not
solver validation or permission to ignore arbitrary poor transition elements.
Corner and 2x2x2 Gauss samples are not a proof of positivity everywhere inside
a trilinear element. Solver stability and solution sensitivity remain untested.

Local evidence: `circle_tilt_matrix/{independent_audit,region_quality}.json`,
`circle_tilt_views/manifest.json` and `CIRCLE_TILT_CASES.html` under the same
dated validation directory. Tests: `test/graded-circle-tilt.test.mjs`.

## Automatic Angle Correction

`angleCorrection: true` opts into reducing the requested magnitude toward zero
in steps of 0.1 degrees until the circular band fits. The step lattice starts
at the requested angle (60.07 -> 55.27, not 55.2). Negative angles are treated
symmetrically, fixing the source's signed-offset test. No correction is applied
to a valid angle; without opt-in, excessive tilt is rejected. The plan records
requested/effective angles, offset, application status and a warning.

This is a geometric correction, not a quality optimizer. Final conformity,
corner/Gauss positivity and volume checks still run; e.g. radius20/thickness6/
coreHalf8/coarseSize2 at 80 degrees still fails after geometric correction.
No failed output is written by the CLI. For coarseSize6, fineSize1, half model,
all four XY ratios at +/-60.07 correct to +/-55.27 and pass these checks.
Positive cases match the raw MATLAB result. Negative cases match a separate
source copy correcting only the absolute-offset and toward-zero sign rules.

The resulting extreme native cases have minimum SJ 0.0560-0.0653, below their
corresponding corrected TG minima 0.0673-0.0859. These are **not covered by the
accepted +/-15-degree quality baseline**. The capability is implemented and
tested, but quality improvement of the extreme mapping remains a separate
open task. The uncorrected negative source still emits a mesh at -60.07.

## Element Budget and Approach

Optional `elementLimit` caps final hex count. Without `approachElementLimit`,
the requested fine size is retained when feasible, otherwise coarsened on
steps of 1% of the originally requested size. With `approachElementLimit:true`,
the finest feasible candidate is chosen on that same lattice. The finer search
stops at 1% of the initial size; the coarse end stops before source-rounded
axis counts become zero. A bounded binary search replaces repeated meshing.
Impossible limits, invalid controls and unsafe search ranges are rejected.

Counting uses the actual native topology: an in-plane 2:1 plus Z3 face column
has 9 cells, a 3:1 plus Z3 column 13. The source's fixed-13 estimate is therefore
not used for mixed ratios. The existing conservative two-million-cell allocation
guard also constrains feasibility. Geometry and radius are unchanged; requested
size, effective size, aligned counts, step index, expected count and actual
fine spacing are disclosed. Final output count must equal the plan and not
exceed the limit. This is a discrete size search, not a globally optimal mesh
or quality optimization.

Original MATLAB/TG 3/3 half-model probes at radius20, H6, d8, coarse2, fine1:

| Mode | Limit | Resolved fine-size parameter | Hex count |
| --- | ---: | ---: | ---: |
| Cap only | 800 | 1.24 | 720 |
| Approach | 1500 | 0.93 | 1404 |

Native and source agree on these probes. The source approach temporarily
overshoots and then backs off in its outer loop; the measured result is not
an over-limit source bug. Twelve native fraction/ratio budget tests additionally
verify count equality and that the preceding finer lattice step exceeds the
limit. Budget and angle parameters are available through the same CLI.

Evidence: `circle_controls_oracle`, `circle_controls_native`,
`circle_controls_views` and `CIRCLE_CONTROLS_CASES.html` under the dated
validation directory. Tests: `graded-circle-correction.test.mjs` and
`graded-circle-budget.test.mjs`. GUI wiring remains pending.
