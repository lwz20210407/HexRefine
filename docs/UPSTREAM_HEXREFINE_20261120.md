# Upstream HexRefine Update Absorption

Date: 2026-11-20

## Version Check

The upstream repository `hl-ren/HexRefine` currently resolves to commit
`9ef7c14f84c34000cb75459a8eb36dd9064d63ab` (`Fix Pages deploy npm launch on
Windows`). Both local development worktrees checked for this project use that
commit as their merge base:

- `h1-2to1-stage-c-overlay`
- `bolt-thread-native`

Therefore the latest upstream baseline is already present in the development
branches. No upstream merge was performed. This is intentional: the branches
contain substantial project-specific work that is not part of upstream main.

## Upstream Capabilities Confirmed

The current upstream changelog describes an active/private-performance feature
set focused on large Hex workflows:

- disconnected Hex selection regions with per-region uvw regularization;
- cached WebGL surface/edge paths and element-center spatial indexes;
- chunked selection and lean active-mesh remapping;
- streaming VTK/INP export and native Q4/H8 session-stream export;
- an offline launcher that chooses a Node.js heap limit from system RAM;
- same-level regularization-domain and topology-lattice caching;
- boundary-shell Hex regularization for a one-layer support shell;
- model-boundary-side omission for transition-shell requirements;
- topology-neighborhood fallback for folded imported Hex blocks;
- explicit transition-support cell IDs in replay;
- BC-face/hanging-face overlays and single-cell/continuous hide picking;
- GUI-to-offline replay helpers and edition-strategy documentation.

These are workflow, selection, regularization, visualization, replay, and
export improvements. They do not constitute a new 2:1/4:2 hexahedral
transition topology or a proof that arbitrary CAD/O-grid cavities are solvable.

## Absorption Decision

### Already inherited

The TypeScript baseline, browser workbench, offline replay entry points,
regularization interfaces, session/export APIs, and Windows Pages deployment
fixes are already in the local branch through the common upstream base.

### Already superseded locally

This branch contains additional research and engineering work on top of that
baseline, including:

- 2:1/3:1 local refinement and transition closure;
- GUI_tg-derived rectangular, circular, cylindrical, reinforced, and staged
  transition workflows;
- concentric circular and mapped core generators;
- O-grid macro fields, solid-sphere and solid-cylinder experiments;
- source-preserving LS-DYNA K regression fixtures and transition audits;
- CAD-front-end and HyperMesh/TrueGrid comparison records.

The upstream branch must not replace these files wholesale.

### Reference only for future integration

The following upstream patterns are worth carrying into later work after the
current uncommitted overlay is stabilized:

1. Per-connected-component uvw regularization should be compared with the
   existing two-to-one selection/support planner.
2. Explicit transition-support cell IDs should be cross-checked against the
   local support-parent and protected-far-field invariants.
3. Boundary-shell regularization is a useful reference for local support-shell
   construction, but it must not be mistaken for a valid O-grid corner macro.
4. Streaming K/INP-like export and offline replay are useful for large real
   specimens, but LS-DYNA K semantics and source-ID preservation still require
   the local writer/audit path.
5. BC-face overlays and center spatial indexes can improve the current HTML/
   GUI diagnostics without changing mesh topology.

## Compatibility Risks

The upstream `main` history is not a safe replacement branch for this local
overlay. A direct merge would remove or rewrite a large amount of locally
maintained transition, GUI61, CAD, O-grid, solid-example, and regression
material. Future absorption must be done by isolated file-level ports with
focused tests and no destructive reset/checkout.

The upstream README also states that large-mesh workflows remain an active
engineering area and recommends GUI-first exploration followed by offline
replay. That guidance is adopted as a workflow recommendation, not as a mesh
quality or solver-acceptance claim.

## Evidence

- Upstream repository: https://github.com/hl-ren/HexRefine
- Upstream changelog: https://raw.githubusercontent.com/hl-ren/HexRefine/main/CHANGELOG.md
- Upstream release guide: https://raw.githubusercontent.com/hl-ren/HexRefine/main/RELEASE.md
- Local branch baseline: `9ef7c14f84c34000cb75459a8eb36dd9064d63ab`

No generated K/INP or large mesh artifact is added by this version audit.
