# Native threaded-solid foundation

Status: experimental, bounded shaft-gauge and nut generators. This is not a
complete bolt/nut assembly workbench or a port of every packaged-app feature.

## Entry points

`src/threaded-solid.ts` exports `helicalThreadRadius`,
`generateThreadedShaft`, and `generateThreadedNut` through `src/index.ts`.
They run in the TypeScript kernel with no Python, MATLAB, CAD host, executable,
license-key or recovered-bytecode runtime dependency.

```ts
const profile = {
  rootRadius: 4.2, majorRadius: 5, pitch: 1.5, handedness: "right" as const
};
const shaft = generateThreadedShaft({
  profile, length: 3, stepsPerTurn: 32,
  coreRadius: 3.6, radiusSegments: 6, arcSegments: 8, surfaceLayers: 4
});
const nut = generateThreadedNut({
  profile, length: 3, stepsPerTurn: 32,
  acrossFlats: 17, clearance: 0.1, angularSegments: 48, radialLayers: 6
});
```

All lengths use one consistent unit. `arcSegments` counts a quarter-circle;
the shaft perimeter has four times that count. Nut `angularSegments` is a
whole-turn count, divisible by twelve so the hexagon vertices align with nodes.
`stepsPerTurn` is a minimum axial sampling density; the actual uniform count is
`ceil(length / pitch * stepsPerTurn)`. These parameters control geometry
sampling, not 2:1 or 3:1 transition templates.

## Geometry and topology

- Generic, single-start truncated-V radial profile. Default crest/root flats
  occupy 1/8 and 1/4 of a pitch; the remaining phase forms two linear flanks.
- Constant helical phase is `z/pitch - handedness*theta/(2*pi) + phaseTurns`.
- The shaft reuses the existing full mapped-circle Q4 core unchanged in every
  section. Only its surrounding radial bands deform to the thread surface.
  The solid therefore contains no central hole or collapsed axis cells.
- The nut interpolates between its helical bore and a fixed hexagonal exterior.
  `clearance` is a radial geometric offset, not a certified thread-fit class.
- Adjacent axial/radial bands share construction IDs; there is no tolerance
  welding, copied external connectivity or global remeshing.
- All output cells are eight-distinct-node H8s. Output can use the existing
  `meshToLsdynaKeyword` mesh-only NODE/SOLID path. Material/contact/BC cards are
  deliberately not invented.

## Acceptance and limitations

Allocation is bounded before mesh generation at 200,000 cells and 400,000
nodes. Every cell must pass a corner scaled-Jacobian floor of at least 0.15
and positive 2x2x2 Gauss Jacobians. Stricter user floors are honored; thresholds
are never automatically relaxed.

Element-integrated volume is independently checked against Simpson integration
of the discrete inner/outer boundary polygons, with relative tolerance 1e-10.
Continuous analytic-profile volume is reported separately. Its tessellation
error is not the discrete conservation error and must be reviewed for each
engineering case. Refining angular/axial sampling reduces that error.

Regression tests check both hands, closed boundary topology, no unexplained
internal free faces, no hanging nodes, preservation of the shaft core and nut
exterior, input immutability, strict rejection, and K round-trip consistency.
Sampled positive Jacobians do not prove global injectivity for arbitrary
extreme inputs. This implementation must not be described as certified ISO
geometry or a stress-analysis-ready assembly.

## Packaged application investigation boundary

BoltHex v1 was supplied as a Windows executable and Python dependencies, not an
open source tree. Static PE and Python 3.13 archive/bytecode inventories identify
section construction, helical radius mapping, bolt/nut/plate assembly and INP
output. Bytecode disassembly is not a recovered original-source certificate,
nor does readability establish a redistribution license.

The TypeScript implementation above is independently written from an explicit
geometric model and existing HexRefine APIs; it does not use recovered code or
tables. A separate user-authorized Python reconstruction now lives under
`tools/bolthex`, documented in `BOLTHEX_RECOVERY.md`. Original files and required
attribution/license notices remain untouched; keys/private evidence are excluded.

The original program's documented `--demo <output.inp>` path was also executed
without patching its executable or license file. It produced 26,352 bolt,
8,640 nut and 5,280 plate H8 elements. The INP was read per part through the
existing HexRefine Abaqus parser; sampled minimum corner SJ values were about
0.446, 0.326 and 0.492. This certifies one original default demo, not all original
options and not equivalence with the independent gauge cases above.

## Remaining work

This checklist concerns the independent TypeScript path. The recovered Python
backend has separate completed and pending capabilities; do not conflate them.

- [ ] Original-app licensed runtime comparison with identical parameters.
- [ ] Hex/cylindrical bolt head and conforming head/shank junction.
- [ ] Unthreaded shank, thread runout, end taper, chamfers and root fillets.
- [ ] Parameter tables, standard/tolerance validation and assemblies.
- [ ] Thread-surface-to-core 2:1/3:1 coarsening with fixed interfaces.
- [ ] Named contact surfaces, separate part placement and GUI integration.
- [ ] Full-model original/candidate side-by-side validation and solver checks.

Do not mark those features implemented merely because a shaft gauge and a nut
can already be exported.
