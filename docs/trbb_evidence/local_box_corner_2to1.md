# TrueGrid Intersecting `trbb` Experiment

Date: 2026-07-25

## Question

Can a local 3D 2:1 transition shell be built by applying the documented
TrueGrid `trbb` operation independently on face, edge, and corner support
blocks?

## Reproduction

Run:

```powershell
C:\TrueGrid\tg.exe i=D:/AI_Tools/HexRefine/docs/trbb_evidence/local_box_corner_2to1.tg
```

The command stream creates an octant containing:

- one fine central block;
- three face blocks with one transition each;
- three edge blocks with two intersecting transitions each;
- one corner block with three intersecting transitions.

## Result

TrueGrid terminates, but reports nine transition warnings. The decisive
messages are:

```text
illegal transition specification ... master side is 3 by 3
illegal multiple transitions ... on the same face
```

The exported diagnostic mesh contains 295 nodes and 192 Hexes. Independent
HexRefine auditing reports 36 unmatched internal boundary faces, so the result
is not conforming.

## Conclusion

Independent seven-Hex transition columns cannot simply be superposed where
orthogonal local-shell fronts meet. This experiment is retained as a negative
regression and motivates the Owen/Shih multi-direction sweep path for local
mapped boxes.

