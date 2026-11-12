# Bilinear CAD Interface Mapping

`tools.bolthex.bilinear_interface_map` maps authoritative, cyclic source Q4
control nets to a closed CAD solid. It separates **support identity** from
**trim topology**. Matching the underlying surface is not permission to restore
a portion removed by a Boolean union or to weld generated mesh nodes.

## API

```python
report = inspect_brep(
    candidate_brep,
    {source_id: four_ordered_world_coordinates},
    geometry_policy=CadAccuracyPolicy.engineering(0.2),
)
```

The existing OCP runtime is required. No Gmsh, MATLAB, TrueGrid or physical
solver is called. Input BRep is size-limited to16MiB and hash-checked after
inspection. References are copied and hashed; the caller must separately bind
them to its original mesh. Inspection neither changes nor writes the geometry.

The solid must pass existing exact BRep, closed-shell, coedge-ownership and
policy-tolerance checks. Eligible candidate supports are nonrational bilinear
Bezier surfaces. All physical faces remain in the solid; other surface types
and collapsed control nets are explicitly listed as excluded from Q4 matching,
not deleted from the domain. A missing, repeated or ambiguous reference match
raises an error. The candidate index is zero-based in the cold-read OCP face
map, **not a Gmsh surface tag**; callers must establish that separate binding.

Eight cyclic/reflected control frames are checked. Only a fixed64ULP-style
binary64 codec bound is used for support matching, not the engineering CAD
distance budget or a caller-selected welding radius. Arbitrary corner-set
permutations and near-but-different supports reject.

PCurve boundaries are inspected separately. Lines, positive-weight rational
Bezier/BSpline controls and trimmed forms are bounded by their controls. Each
edge must remain on exactly one unit-square side, with monotone controls and
complete nonoverlapping parameter coverage of all four sides. Unsupported
curves, holes, gaps, displaced sides and backtracking controls block direct
planning. Split sides retain their chain obligations instead of discarding
extra vertices. Corner-to-actual-trim-vertex differences are independently
reported; a matching support never erases those differences.

`directFourCornerInstallEligible` only denotes a four-corner topology planning
candidate. It is NOT exact3Dedge identity, a performed installation, a final
mesh-boundary certificate or positive cell Jacobian evidence. The report
requires final mesh checks and always retains `meshInstalled=False` and
`wholeMeshAccepted=False`. It does not change an existing planner's defaults.

## Real Screw Domain

On the complete source-derived neck/core union (2318physical faces), all2160
source corewall Q4 supports have unique counterparts.2145 qualify for direct
four-corner planning;15 require explicit trim/edge-chain reconstruction.
Seven of those15have additional CAD vertices. The largest diagnostic corner
shift is2.4774703944926345e-7mm. This small number does not authorize welding:
some trims are real changes in the union's material boundary.

Affected parent IDs:
`2902,2903,2904,2905,2906,2907,2908,2910,2911,2912,2913,2915,2916,2921,2924`.

Evidence: `F:/PythonWoking/temp/20261112-screw-interface-continuation/`.
`inspect_interfaces.py` binds the actual frozen source nodes, face ledger and
candidate BRep; `interfaces-v1.json` retains all2160interface records. The
test suite reconstructs the actual mapping instead of trusting receipt flags.
Synthetic tests cover all eight frames, collisions, wrong control order,
split edges, interval gaps/overlap, displaced/curved sides and invalid input.

The final selected suite passed10tests with zero skips, including a fresh
inspection of the actual2160references. The independent review reproduced
the full support/blocked counts and raised a contradictory public-helper
endpoint/control example; that input now rejects and has a regression test.
Caller references are snapshotted, not actively monitored for concurrent
caller changes. The report hashes the inspected snapshot, not later mutations.

No complete Screw K/INP or new mesh acceptance is claimed by this module.
