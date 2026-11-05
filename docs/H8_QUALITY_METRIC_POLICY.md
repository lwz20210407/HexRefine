# H8 Quality Metrics: Correcting The0.15 Claim

There is no verified vendor-wide standard establishing scaled Jacobian0.15
as sufficient H8 engineering quality. It was a historical project screen.
Calling a mesh passing that screen generally quality-accepted was too broad.
Existing evidence is retained, not retroactively rewritten or silently waived.

## Official References And Different Definitions

| Source | What is actually documented |
| --- | --- |
| [Coreform Cubit](https://coreform.com/cubit_help/latest/mesh_generation/mesh_quality_assessment/hexahedral_metrics.htm) | Hex scaled Jacobian acceptable range0.5to1; not a universal solver error limit |
| [Verdict reference, section7.11](https://raw.githubusercontent.com/sandialabs/verdict/master/SAND2007-2853p.pdf) | Scaled determinant evaluated at8corners AND center, normalized by corresponding vector lengths |
| [HyperMesh](https://2024.help.altair.com/2024.1/hwdesktop/hwx/topics/pre_processing/meshing/element_quality_calculations_hypermesh_r.htm) | Minimum/maximum determinant ratio; Gauss-point values>=0.7generally acceptable. This is NOT scaled Jacobian |
| [ANSYS Meshing](https://ansyshelp.ansys.com/public/Views/Secured/corp/v242/en/wb_msh/msh_jacobian_ratio.html) | Corner/Gauss use min/max; MAPDL uses max/min. Positive Gauss samples can coexist with nonpositive corners |
| [Abaqus/CAE](https://docs.software.vt.edu/abaqusv2025/English/SIMACAECAERefMap/simacae-t-mgnverifybtn.htm) | Shape/size metrics and formulation-specific Standard/Explicit input-processor analysis checks; no0.15universal rule in this source |
| [LS-DYNA official guidance](https://lsdyna.ansys.com/convergence/) | Avoid small/negative Jacobians and severe distortion; review formulation, connectivity and solver diagnostics. The described initialization-quality listings start atR14, not localR11 |
| ANSA | A sufficient public official numeric definition/default table was not obtained in this check. Third-party screenshots are not substituted for a universal ANSA standard |

The attempted BETA-CAE presentation link now redirects to a product landing
page; it is not treated as a retrieved current numerical quality manual.
The LS-DYNA page concerns implicit convergence and is not used to invent a
universal explicit-analysis cutoff. Neither source establishes SJ0.15.

## Revised Reporting Contract

1. Geometric validity is separate: repeated/collapsed connectivity, zero or
   negative Jacobians, invalid topology, hanging interfaces, overlap and volume
   loss are not excused by a quality-policy choice. Finite Jacobian samples are
   not a proof of positivity everywhere.
2. Report corner-only SJ and corner-plus-center SJ separately. The legacy
   implementation sampled only corners; that is not labelled the complete
   Verdict sampling convention.
3. Report corner and Gauss determinant ratios separately; do not translate
  0.7into an SJ threshold or take a global minimum/max over different cells.
4. Provide counts,percentiles and offending EIDs, then review physical regions,
   aspect/size, element formulation and convergence. One minimum is insufficient.
5. Vendor ranges are reference/advisory comparisons, not blanket promises of
   engineering suitability. Solver checks and physical validation remain needed.
6. The0.15value is retained ONLY as an explicitly labelled historical screen
   in compatibility paths. It is not automatically removed to let an existing
   failed candidate pass, nor elevated to a standards-based acceptance claim.

`tools.bolthex.h8_quality_report.measure_h8` and `summarize_h8` implement the
read-only statistics. Reports intentionally have `engineeringQualityAccepted`
and `solverQualityVerified` false. Installed VTK/Verdict independently checks
the corner-plus-center metric on regular,elongated,sheared and warped cells.
An affine shear can have scaled Jacobian about0.2425and determinant ratio1;
an elongated orthogonal box can have SJ1and a very poor edge aspect ratio.
These regression examples prevent conflating the metrics.

`mesh_audit` and `truegrid_screw` retain legacy pass/fail compatibility but now
explicitly label that basis and deny engineering acceptance from it alone.
They also explicitly check the center. A regression with a180-degree rotated
top face has positive corner/Gauss samples but collapses at its center; this
case must reject rather than pass the historical sample set. This is a validity
bug fix, not a changed quality target. No source K, solver configuration or
numeric threshold was altered merely to make a candidate pass.
