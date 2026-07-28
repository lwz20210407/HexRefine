import type {
  TwoToOneCapabilityReport,
  TwoToOneCompensationOptions,
  TwoToOneEntityId
} from "./two-to-one-capability.js";

export type Point = readonly number[];
export type MutablePoint = number[];
export type Element = readonly number[];
export type ElementKind = "Q1" | "H1";

export interface ReadonlyMesh {
  /**
   * Coordinates are stored in array order, while element connectivity uses
   * 1-based node ids to stay compatible with the Mathematica notebooks and
   * Abaqus-style input files.
   */
  readonly nodes: readonly Point[];
  readonly elements: readonly Element[];
  readonly kind?: ElementKind;
}

export type Mesh = ReadonlyMesh;

export interface LocalRefinement {
  nodes: Point[];
  elements: Element[];
  kind: ElementKind;
  source: string;
}

export interface BoundaryPair {
  selectedElementId: number;
  neighborElementId: number;
  selectedBoundary: number[];
  neighborBoundary: number[];
}

export interface ReplaceElement {
  elementId: number;
  refinement: LocalRefinement;
}

export interface RefineOptions {
  mergeTolerance?: number;
  includeTransitions?: boolean;
  /**
   * Hex edge subdivision factor. The established HexRefine templates use 3;
   * the 2 option uses a uniform 1-to-8 core and a conforming 4-to-2 shell.
   */
  hexRefinementRatio?: 2 | 3;
  /**
   * Logical Hex lattice axis used by structured 2:1 full-section completion.
   * Omit it to choose the least-expanding axis with even transverse counts.
   */
  hexTransitionAxis?: 0 | 1 | 2;
  /**
   * Structured 2:1 selection preparation. "section" preserves the established
   * full-section completion; "local" keeps a regularized rectangular core and
   * closes it with the three-direction sweep strategy.
   */
  hexTwoToOneSelectionMode?: "section" | "local";
  /** Bounded compensation policy used by Hex 2:1 planning entry points. */
  hexTwoToOneCompensation?: TwoToOneCompensationOptions;
  transitionSupportElementIds?: readonly number[];
  regularizeHexSelection?: boolean;
  regularizeHexBoundaryShell?: boolean;
  regularizationTolerance?: number;
}

export interface HexSelectionRegularizationOptions {
  tolerance?: number;
  boundaryShellOnly?: boolean;
  transitionAxis?: 0 | 1 | 2;
}

export interface HexIndexRange {
  min: [number, number, number];
  max: [number, number, number];
  dimensions: [number, number, number];
}

export interface RegularizedHexSelection {
  originalElementIds: number[];
  selectedElementIds: number[];
  addedElementIds: number[];
  removedElementIds: number[];
  gridDimensions?: [number, number, number];
  indexRange?: HexIndexRange;
  warnings: string[];
}

export type RefinementRole = "unchanged" | "selected" | "face-transition" | "edge-transition" | "corner-transition";

export interface RefinementCellData {
  parentElementId: number;
  role: RefinementRole;
  /**
   * Numeric template code for compact GUI/VTK coloring.
   * H1 uses 27/13/5; Q1 uses 9/4/5; unchanged cells use 0.
   */
  templateCode: number;
}

export interface RefinementSummary {
  selectedElementCount: number;
  faceTransitionElementCount: number;
  edgeTransitionElementCount: number;
  cornerTransitionElementCount: number;
  unchangedElementCount: number;
  outputNodeCount: number;
  outputElementCount: number;
}

export interface HexRefinementQualitySummary {
  ok: boolean;
  parentElementCount: number;
  childElementCount: number;
  parentOrientedVolume: number;
  childOrientedVolume: number;
  relativeVolumeError: number;
  parentMinimumOrientedScaledJacobian: number;
  childMinimumOrientedScaledJacobian: number;
}

export interface RefinementResult {
  mesh: Mesh;
  cellData: RefinementCellData[];
  summary: RefinementSummary;
  quality?: HexRefinementQualitySummary;
  regularization?: RegularizedHexSelection;
  twoToOne?: TwoToOneCapabilityReport<number>;
}

export interface RefinementPlanItem {
  parentElementId: number;
  role: RefinementRole;
  templateCode: number;
  outputElementCount: number;
}

export interface RefinementPlanSummary {
  selectedElementCount: number;
  faceTransitionElementCount: number;
  edgeTransitionElementCount: number;
  cornerTransitionElementCount: number;
  unchangedElementCount: number;
  estimatedOutputElementCount: number;
}

export interface PerParentRefinementPreview<TId extends TwoToOneEntityId = number> {
  kind: ElementKind;
  planMode: "per-parent";
  plan: RefinementPlanItem[];
  summary: RefinementPlanSummary;
  quality?: HexRefinementQualitySummary;
  regularization?: RegularizedHexSelection;
  twoToOne?: TwoToOneCapabilityReport<TId>;
}

export interface AggregateRefinementPlanSummary {
  inputElementCount: number;
  changedInputElementCount: number;
  preservedInputElementCount: number;
  outputElementCount: number;
}

export interface AggregateRefinementPreview<TId extends TwoToOneEntityId = number> {
  kind: ElementKind;
  planMode: "aggregate";
  plan: [];
  summary: AggregateRefinementPlanSummary;
  compound: {
    kind: "transition-shell-rebuild";
  };
  quality?: HexRefinementQualitySummary;
  regularization?: RegularizedHexSelection;
  twoToOne: TwoToOneCapabilityReport<TId>;
}

export type RefinementPreview<TId extends TwoToOneEntityId = number> =
  | PerParentRefinementPreview<TId>
  | AggregateRefinementPreview<TId>;

export interface BoxRange {
  min: Point;
  max: Point;
}
