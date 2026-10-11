# GUI_tg 6.1 Oracle Validation

The first comparison milestone below is retained as historical evidence.
Subsequent native implementation status and APIs are in
[Native Rectangular Grading](GUI61_NATIVE_RECTANGLE.md).

Date: 2026-10-11. This is a development comparison workflow, not a production
dependency or a claim that all GUI_tg generators have been ported.

## Verified Chain

1. Run the recovered MATLAB 6.1 rectangular callback `Code_Creat1` (full GUI
   source lines 883-2198, including the parameter function beginning at 978).
2. Save its command string using the recovered `Code_tg` writer.
3. Run that `.tg` with the installed TrueGrid 3.1.3.
4. Read the emitted K with both HexRefine and PyDYNA and compare their data.
5. Independently inspect topology, volumes, corner scaled Jacobians, and 2x2x2
   Gauss-point Jacobians. Where needed, run the recovered MATLAB repair chain
   and retain both raw and repaired files.
6. Compare the independent native HexRefine output with the measured oracle.

The MATLAB test closure uses real hidden `uicontrol` inputs. It retains the
original parameter and TG-command formulas. Instrumentation exports parameter
arrays, skips `showImage`, makes `Button_Color` a no-op, and gives the saved TG
an ASCII filename. It does not modify the recovered originals. This is a
callback replay, not a new full-GUI click-through test. The canonical command
sequence was compared against the supplied original GUI output.

Recovered GUI SHA-256:
`1d33bd615da52e039e5a22e3144d7676d91622e515f65e61ee537ce0e910fdbf`.
Extracted rectangular callback SHA-256:
`9740a7925db2539dfcf0dcd84ab5baf370e37a02be64deffef3091904fe67653`.
Recovered proprietary source is not copied into this repository.

## TrueGrid Launch

The original `Opentg` calls MATLAB `system(path)` on a saved `.tg`, relying on
the Windows file association. This is not itself an unattended runner. On the
tested host, positional input, absolute positional input, and `i=` without
`g=nogui` did not complete. A GUI file-open run did generate the smoke mesh.
The documented no-GUI mode then completed without interaction:

```text
C:\TrueGrid\tg.exe i=<absolute-case-path>/reference.tg g=nogui s=<absolute-case-path>/session.tg
```

`tools/run-truegrid-oracle.py` implements the verified invocation with a hidden
console, a bounded timeout, input/output hashes, explicit case-local output,
and captured diagnostics. It refuses an existing output or session. Its
command whitelist covers only the reviewed rectangular command subset; this
is not a complete TrueGrid parser or an untrusted-code sandbox.

```powershell
python -B tools/run-truegrid-oracle.py <absolute-case-path>/reference.tg
```

The input deck must have one absolute case-local `mof`, `lsdyna keyword`, and
end with `write;` / `exit;`. A successful run reports `execution_ok`, but always
leaves `mesh_validated: false`: a normal process exit does not certify a mesh.
Only the runner's own timed-out process is terminated. Existing user sessions,
installation settings, license files, and original benchmark files are not
changed.

References: [TrueGrid manuals](https://truegrid.com/resources/truegrid-manuals/manuals),
[User's Manual, Volume 1](https://truegrid.com/TGMAN400A.pdf),
[Tutorial: rerunning session files](https://truegrid.com/Data/TGTUT22-min.pdf).

## Measured Results

Nine parameter configurations plus one repeat completed in 0.48-1.49 seconds
per TG run. MATLAB reported valid parameters and TrueGrid emitted no transition
warnings in these runs. The table concerns **raw TrueGrid output**, before repair.

| Case | Nodes | Hexes | Unexpected internal free faces | Minimum corner SJ |
| --- | ---: | ---: | ---: | ---: |
| Single 3/3/3, half | 5566 | 4324 | 40 | 0.308422 |
| Mixed 2/3/3 | 5544 | 4272 | 40 | 0.316227 |
| Mixed 3/2/3 | 5692 | 4404 | 40 | 0.308422 |
| Single 2/2/2 | 7984 | 6528 | 64 | 0.392232 |
| 3/3, thickness unchanged | 7126 | 5736 | 0 | 0.689655 |
| Double 3/3/3 | 17962 | 16236 | 160 | 0.147043 |
| Single 3/3/3, 10-degree tilt | 5566 | 4324 | 40 | 0.289867 |
| Single 3/3/3, quarter | 2844 | 2162 | 20 | 0.308422 |
| Single 3/3/3, full | 10763 | 8648 | 80 | 0.308422 |

Internal free-face counts are not the same metric as the conformance checker's
number of hanging-node/edge findings. Do not substitute one for the other.
Positive SJ and absence of TrueGrid warnings did not imply conforming interfaces.
Only the canonical half 3/3/3 case has a freshly replayed repair in this batch.

Canonical evidence:

- The generated TG commands equal the supplied rectangular TG after normalizing
  whitespace and excluding comments and the case-specific `mof` path.
- The new raw K is byte-identical to the supplied `juxingbaban.k` and to the
  repeat run: SHA-256
  `cdd2868eba4c7ad273ffedc6a74c0ec5d3e61e0f75311021d6c3e12f98a05e13`.
- Running the recovered repair on the **new TG output** produces 5574 nodes /
  4340 hexes and byte-identical `OutPut.k`: SHA-256
  `bfd9ee9769d8e5fe4db210c584d79933ead78579cf7934e53d08f793d55d8479`.
- The native HexRefine benchmark produces 5574 nodes / 4340 hexes without
  MATLAB/TG or a repair pass, with zero unexpected internal free faces,
  minimum corner SJ 0.308423, positive Gauss Jacobians, and conserved volume.
  Its external faces agree with the repaired reference; 32 cells use a
  different interior decomposition. It is not a byte-identical implementation.

## Ported Versus Pending

`src/graded-rectangle-plan.ts` implements **count/partition planning only**.
Its D/B/C/A and double-band counts agree with the measured MATLAB arrays in all
ten calls. Tests also separate divisibility by 16 from cumulative reduction by
4. This is not yet a generic mixed-ratio or double-band mesh generator.

Intentional contract changes include rejecting fractional outer counts and
resolving thickness-off before count alignment, without state inherited from
an earlier GUI invocation. More input combinations still require measurement.

A separate stateful experiment confirmed why the thickness-off change is
needed: with thickness 350 and target spacing 50, two successive calls in the
same recovered closure produced 9 layers and then 7 layers. Both resulting TG
files were executed. The earlier call inherited `biii=1/3` when aligning the
count; the next inherited `biii=1`. Native planning deterministically chooses
7 layers. This is an explicit behavioral correction, not an exact replay of
the GUI's state-dependent count alignment.

`test/gui61-rectangle-plan.test.mjs` contains fixed native regressions, including
the independent 4340-hex benchmark. `test/gui61-keyword-import.test.mjs` covers
fixed-column K parsing exposed by the repaired MATLAB writer. Neither suite
requires MATLAB, TrueGrid, or the recovered sources.

Mixed-ratio intersection templates, generic double-band generation, exact tilt
mapping, curved generators, 2D output, and beam/concrete semantics remain separate
implementation milestones. Do not count a successful oracle run as a port.

## Local Evidence Bundle

The user-authorized retained validation directory is:
`F:\PythonWoking\temp\20261011-hexrefine-gui61-validation`.

- `build_matlab_oracle.py` and `matlab_oracle/run_cases.m`: replay preparation.
- `matlab_oracle/source_manifest.json`: original hashes and instrumentation.
- `matlab_oracle/cases.json`: all inputs.
- Each case: `reference.tg`, `matlab_parameters.json`, `juxingbaban.k`, TG log,
  run metadata, parsed mesh, and independent audit.
- `matlab_oracle/baseline333/repaired/OutPut.k`: fresh repair result.
- `matlab_oracle/hexrefine_comparison.json`: actual parameter-array comparisons.
- `matlab_oracle/pydyna_and_repair_verification.json`: independent-reader and
  byte-identity checks.
- `reusable_runner_verified/`: actual run of the repository launcher.

These paths are development evidence, not install/runtime dependencies. The
private recovered-source archive and generated user meshes are not published.
