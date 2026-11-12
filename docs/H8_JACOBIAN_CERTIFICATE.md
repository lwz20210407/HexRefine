# Trilinear H8 Jacobian Positivity

`tools.bolthex.h8_jacobian_certificate.certify_cell` converts the actual stored
binary64 corner coordinates to exact rational values. It forms the determinant
polynomial of the real trilinear interpolation, changes to tensor Bernstein
coefficients and, when necessary, bisects parameter boxes with exact de
Casteljau arithmetic. Strictly positive coefficients certify the entire closed
reference cube. The coefficient functions are shared with existing native
tip-geometry tooling rather than another polynomial parser.

```python
certificate = certify_cell(eight_xyz_rows, maximum_depth=3, maximum_boxes=4096)
```

`certified=True` requires every box to have a strictly positive exact lower
bound. A nonpositive exact box-corner determinant is reported as a witness.
A depth or box limit is **inconclusive**, not proof of a bad cell; it never
becomes a passing result. The proof concerns the real interpolant of those
binary64 values, not floating-point evaluation error or shape-quality bands.
No scaled-Jacobian threshold, overlap/geometry claim, solver or whole-model
acceptance is implied.

The full-source patch installer can request these certificates for its new
and moved-neighbour region. Old protected source defects are not silently
certified by a local macro's success.

Tests cover affine and sheared cells, reversed/collapsed cells, a positive
120degree twist that requires subdivision, depth/box limits, an internal
zero determinant hidden by positive outer corners/Gauss, and the actual
15-H8 head macro loaded from caller-selected evidence. Set
`ACTUAL_MACRO_CERTIFICATE_NPZ` to that actual candidate before running
`python -B -m unittest tools.tests.test_h8_jacobian_certificate -v`.
Without that explicit fixture, the actual-case check is visibly skipped.
