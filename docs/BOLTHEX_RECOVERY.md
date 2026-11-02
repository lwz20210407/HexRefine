# Authorized BoltHex kernel reconstruction

The user supplied and explicitly authorized local study and integration of
BoltHex v1.0.0. The original executable and license file are not modified.
Original product notices remain in `tools/bolthex/version.py`; no key or
personal license details are copied into the repository.

## What Is Actually Recovered

`tools/bolthex` contains readable, executable Python source for section
construction and canonical shared-node keys, real helical radius mapping,
solid bolt/head assembly, hex/round/dome nut generation, rectangular/circular
plate generation, standard-size tables, named regions/surfaces and INP output.
These are decompiled/corrected modules, not the earlier independently written
TypeScript shaft-gauge approximation.

Generation depends on Python and NumPy only. It does not call the original
executable, import recovered bytecode, or require Abaqus, MATLAB or TrueGrid.
The TypeScript kernel and this recovered Python backend are distinct; they
must not be advertised as an equivalent TypeScript port.

```powershell
python -B -m tools.bolthex --demo <existing-case-directory>/demo.inp
```

The demo CLI refuses to overwrite a file. Low-level Python APIs intentionally
preserve the original generator semantics and do not constitute a hardened
arbitrary-input service. The CLI's inherited centre-volume check is not a
corner/Gauss quality certificate.

The Node export adapter reuses the existing strict mixed-PID K writer:

```powershell
node scripts/generate-bolthex-demo.mjs <new-case-directory> --python <python-executable>
```

It creates the original INP, a mesh-only NODE/SOLID K, an explicit part/source-
surface sidecar and a read-back report. Bodies remain separate, with distinct
PIDs; no contact/material cards or cross-part coordinate welding are invented.
The adapter is a Python-backed Node workflow, not a pure TypeScript port.

## Evidence

- Original EXE built-in M16 bolt/nut/threaded-plate demo: 26,352 / 8,640 / 5,280
  H8 elements. Reconstructed source output is byte-identical, including regions
  and named surface records.
- Original/recovered demo SHA256:
  `7ff46daa0e757b0e46db305bdbdb5640cabb33a603fbfdc4d69df2aaa71af7e0`.
- A bounded catalogue matrix covers 14 sizes M6..M36, three bolt head shapes,
  three nut shapes, rectangular/circular plates, and thread on/off: 224 cases.
  Each of the 224 recovered INP files exactly matches original application
  bytecode execution; node, connectivity and surface hashes also match.
- That matrix uses fixed documented test seeds, not every possible mesh count,
  fine pitch, clearance, offset, length or shape parameter combination.
- A separate numerical audit checks all eight corner and eight Gauss points
  and integrated cell volumes in each generated case. All 224 sampled cases
  meet corner SJ >= 0.15 and positive Gauss/integrated volume in that matrix.
- The matrix is **not** 224 GUI runs. The built-in EXE demo and actual GUI
  exports are separate evidence categories. No screenshot is a substitute for
  the numerical and connectivity checks.

Private artefacts live under the task's dated temp directory: original
bytecode, raw decompiler output, corrected source, INP archives, differential
manifests, numerical audits and GUI exports. They are not bundled with the
public regression tests.

## Still Pending

- Same-parameter GUI-export comparisons across shape families and sizes.
- Complete GUI reconstruction/connection; the raw GUI decompilation is not
  certified executable and is deliberately not included in this package.
- Adversarial and non-square geometry/interface audits beyond the catalogue.
- Complete face-conformance and engineering-quality acceptance, not only the
  inherited centre-volume check or sampled Jacobians.
- Integration of near-thread 2:1/3:1 transition/coarsening into this recovered
  topology and connection to the project's workbench.

Read `NOTICE.md` and `RECOVERY_PROVENANCE.json` before reuse or distribution.

Additional profile research and STEP/native HM adapters are documented in
`FASTENER_EXPORT_ADAPTATION.md`; these are extensions around the recovered
kernel, not a claim that every upstream repository or GUI option is ported.
