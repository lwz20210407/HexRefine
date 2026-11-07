# Screw Boundary Budget

This separate API measures whether the actual frozen end-face mesh approximates
the reviewed source geometry within the existing engineering budget. It does
not change `screw_endpoint_contract`, its exact support test, or its defaults.

## API

```python
from tools.bolthex.geometry_accuracy_policy import CadAccuracyPolicy
from tools.bolthex.screw_boundary_budget import audit_boundary_budget

report = audit_boundary_budget(
    raw_k, phase_k, phase_report, frozen_collar_directory, new_output_directory,
    geometry_policy=CadAccuracyPolicy.engineering(.2),
)
```

`geometry_policy` is mandatory; `None` and other profiles/declared sizes reject.
The base policy is reconstructed so subclass method overrides cannot relax it.
The existing phase report must bind the exact reviewed raw/phase files and the
same `.2 mm` declaration / `.0005 mm` critical distance budget. There is no
implicit engineering-mode switch or threshold escalation.

The frozen directory is the actual `whole-ratio060-v2` bundle with `handoff.json`,
`report.json`, `node-supports.json`, `caps.json`, and `composite.npz`. The existing
endpoint frozen loader validates the source pair, supports, parent ledger and
retained rows. Existing cavity extraction and face ownership derive the actual
end inventory; no template search or Node process is needed by this API.

## Measurement and Protection

- Complete 76 end groups / 74 distinct parents / 308 actual annular Q4s.
- All 1080 retained-tooth outer root faces, including 37 endpoint roots, retain
  their original raw/phase cycles and opposite retained owner.
- Original node coordinates and IDs are bitwise unchanged. The existing frozen
  loader also verifies all 3968 retained outside element rows.
- Each source annulus is the real source Q4 restricted to radial `.6..1`:
  replace each axis corner with its unique same-Z adjacent outer corner scaled
  by `.6` in XY, retaining the original outer corners and ordering.
- Every source and child is a real degree-(1,1) trimmed Bezier face with exact
  BRep validity checked. No merge, sew, healing or tolerance enlargement occurs.
- Forward: 5x5 samples per child, 7700 per source variant. Reverse: 9x9 samples
  per source annulus to its unsewn four/five-child face compound, 6156 per variant.
- Raw and phase are compared directly and independently, never by adding two
  separate error budgets. Distances are to trimmed boundary faces, not solids.

The measurement is finite sampling, not a continuous/global Hausdorff bound.
`sampledBoundaryBudgetPassed` is distinct from `exactSourceSupportVerified`.
This API does not assess exact equivalence (`exactSupportTested=false`) and does
not claim that finite sampling establishes it. The existing exact planner is
unchanged and remains the owner of exact support reasoning.

## Outputs and Failure

Output must be a fresh directory under an existing parent, outside every input
bundle. No source or existing output is overwritten; no K, NPZ copy or CAD
replacement is generated.

`measurements.json` contains every child forward maximum/worst UV/XYZ and every
source-annulus reverse maximum/worst UV/XYZ. `report.json` binds its exact bytes
and SHA-256 and records input SHA-256 values, policy, complete inventories,
variant maxima, over-budget counts and whole-collar limitations. Artifact hashes
come from the generated payload, not a late scan that could bless changed files.
Inputs, measurement bytes and the pending report are rechecked before exclusive
atomic hard-link publication of `report.json`.

Finite measurements above budget produce a completed diagnostic report with
`status="sampled-budget-exceeded"` and `sampledBoundaryBudgetPassed=false`.
Invalid inputs, nonfinite measurements, mutation and publication failures raise;
after output creation, they produce `rejection.json` without a success report.
Pending files are not published reports. `globalHausdorffCertified`,
`wholeScrewAccepted`, `coreFilled` and `engineeringQualityAccepted` remain false.

All input sizes are checked before hashing; hashing is streamed with a growth
limit. Raw/phase and compressed NPZ are capped at 32 MiB; the existing loader
caps expanded NPZ at 32 MiB. Frozen report/support JSON caps are 16/8 MiB;
phase policy, handoff and caps JSON are capped at 2 MiB. Measurement output is
capped at 2 MiB and the summary/rejection report at 128 KiB.

## Whole-Collar Context

The report preserves the frozen bundle's volume and quality context instead of
promoting a partial hollow composite. Its cell-volume sum is approximately
32.820557658 mm^3 versus raw 40.745844971 mm^3 (about 19.4505% missing; core not
filled). Collar minimum corner/centre SJ is 0.144765843. These volume/collar
context values are read from the hash-bound frozen report. Its legacy
9-point determinant ratio is not an 8-Gauss ratio, and its 36 collapsed-position
classification is **not the complete inventory of retained corner issues**.
`reportedContextProvenance` explicitly binds the frozen/phase report hashes and
source JSON field names. It sets `collarQualityIndependentlyRecomputed=false`
and `wholeModelVolumeIndependentlyRecomputed=false`; the relative volume
differences are only arithmetic on those reported volumes.

`actualNamedQuality` independently recomputes current `measure_h8` metrics on
the 6128 raw reference cells and the actual 3968 frozen retained cells. It binds
the metric implementation SHA-256, raw K SHA-256, frozen NPZ SHA-256, and selected
EID hashes. Regions are defined by EID ranges; every actual numeric PID is 1.
Its separate `independentlyRecomputedByThisAPI=true` flag applies only to these
named actual reference/retained metrics, not to the legacy collar/volume context.

| Raw region | EIDs | Cells | Finite corner SJ <= 0 | Nonfinite corner SJ | Gauss determinant samples |
| --- | --- | ---: | ---: | ---: | --- |
| Head | 1..2816 | 2816 | 64 | 0 | All finite positive |
| Neck | 2817..2888 | 72 | 36 | 36 | All finite positive |
| Body (reference only) | 2889..5048 | 2160 | 2160, all zero | 0 | All finite positive |
| Tooth | 5049..6128 | 1080 | 0 | 0 | All finite positive |

The retained 3968-cell scope has 100 finite nonpositive and 36 nonfinite corner
SJ values. The 3896-cell diagnostic subset excluding neck has 64 finite
nonpositive and zero nonfinite corner SJ values. Both retain entirely positive
finite Gauss determinant samples. Raw and frozen retained metric arrays are
compared including NaNs; head/neck/tooth connectivity and PID remain unchanged.
The 3896 subset is a diagnostic selection, not a removal performed by this API.

`cornerScaledJacobian` means the minimum scaled Jacobian at eight corners;
zero-length Jacobian directions can produce NaN. `minimumGaussDeterminant`
means the minimum determinant at eight Gauss points. Gauss positivity does
**not** establish corner positivity. Finite nonpositive and nonfinite values
are reported separately, without silently converting NaN to zero. These are
named finite-sample diagnostics: the 64 head cases are not labeled inherently
solver-invalid, and no formulation-independent engineering verdict is granted.

## Verification

Run with the existing CAD Python, `-B`, and explicitly set `SCREW_ORACLE_K`,
`SCREW_PHASE_K`, `SCREW_BOUNDARY_POLICY_REPORT`, `SCREW_COLLAR_DIR`, and
`BOLTHEX_TEST_ROOT` to the reviewed actual inputs and a dated scratch directory:

```powershell
& 'D:/AI_Tools/conda-envs/text-to-cad/Scripts/python.exe' -B -m unittest tools.tests.test_screw_boundary_budget -v
```

Full-data tests cover both complete source comparisons, protected interfaces,
hash/policy errors, in-memory frozen node/owner tampering without copying the
case, real bad-source bytes, named retained quality/NaN distinctions,
finite over-budget and nonfinite measurements,
fresh-output/size guards, and mutation at publication. Without explicit actual
paths or OCCT the actual-case tests skip; skips are not actual validation.
