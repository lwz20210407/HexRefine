# Native Circular Target: Initial Subset

`generateCircularGradedMesh` is an experimental native TypeScript generator.
It currently supports a zero-tilt circular solid with a square central fine
region, independent X/Y reductions 2 or 3, and the circular source branch's
fixed Z reduction 3. It does not use MATLAB or TrueGrid at runtime.

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

- Circular tilt and its offset-dependent circular corner construction.
- The GUI's automatic fine-size search to approach an element-count limit.
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
