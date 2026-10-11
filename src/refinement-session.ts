import type {
  Element,
  ElementKind,
  HexRefinementQualitySummary,
  LocalRefinement,
  Mesh,
  Point,
  ReadonlyMesh,
  RefinementPreview,
  RefinementRole,
  RefineOptions
} from "./types.js";
import {
  assertMergeToleranceBelowFinalEdgeLimit,
  elementVertices,
  inferMeshKind,
  mergeCoincidentNodesWithMap,
  minElementEdgeLength,
  replaceElements
} from "./mesh.js";
import {
  buildDefaultRefinementPlanInternal as buildDefaultRefinementPlan,
  type ClassifiedReplacement
} from "./refinement-planner-internal.js";
import { checkNoHangingNodes, type ConformanceReport } from "./conformance.js";
import {
  currentRefinementSessionConformanceCertificate,
  certifyRefinementSessionBaseline,
  prepareIndexedConformanceBaseline,
  publishIndexedConformanceCertificate,
  BaselineConformanceError,
  type IndexedConformanceCertificate,
  type RefinementSessionConformanceMetadata
} from "./refinement-conformance-certificate-internal.js";
import {
  auditIncrementalConformance,
  buildConformanceSpatialIndex,
  type ConformanceSpatialCell,
  type ConformanceSpatialIndex
} from "./refinement-incremental-conformance-internal.js";
import {
  auditHexRefinementPatchQuality,
  auditHexRefinementQuality
} from "./hex-quality.js";
import {
  auditNetHexCellReplacementQuality,
  auditNetHexCellReplacementQualityFromState
} from "./refinement-session-quality-internal.js";
import { inferHexElementLattice } from "./regularization.js";
import { H1_FACES } from "./topology.js";
import {
  cloneTwoToOneCapabilityReport,
  DirectTwoToOnePlanningError,
  normalizeTwoToOneCompensation,
  TwoToOnePlanningError,
  type NormalizedTwoToOneCompensation,
  type ReadonlyTwoToOneCapabilityReport,
  type TwoToOneCapabilityReport,
  type TwoToOneCompensationAction,
  type TwoToOneCompensationCarrier,
  type TwoToOneCompensationOptions
} from "./two-to-one-capability.js";
import {
  GeometricFaceIndex,
  type GeometricFace
} from "./geometric-face-index.js";
import {
  createMergeBucketLayout,
  forEachCandidateMergeBucketKey,
  mergeBucketKey,
  type MergeBucketLayout
} from "./merge-buckets-internal.js";
import { pointEquals } from "./vector.js";
import {
  assertHexPatchQualitySummary,
  assertHexRefinementQualityReport,
  assertHexPatchQuality,
  freezeTwoToOnePlanningErrorDiagnostic,
  HexPatchQualityError,
  qualityPlanningErrorCode
} from "./refinement-errors.js";
import {
  buildRefinementHistoryClosure,
  buildRefinementHistoryIndex,
  freezeRefinementSessionCommandRecipe,
  RefinementHistoryClosureError,
  type RefinementCellGeometrySnapshot,
  type RefinementHistoryClosure,
  type RefinementHistoryIndex,
  type RefinementSessionCommandRecipeV1
} from "./refinement-history.js";
import {
  RefinementCellGeometryIndex,
  RefinementCellGeometryMatchError,
  snapshotRefinementCellGeometry
} from "./refinement-cell-geometry.js";
import {
  assertRefinementSessionStateReferencePublisherInternal,
  commitRefinementSessionStateReferenceBatchInternal,
  createDirectRefinementSessionState,
  prepareRefinementSessionStateReferenceBatchInternal,
  refinementSessionStateOrdinaryArrayLengthInternal,
  refinementSessionStateOrdinaryArraySnapshotInternal,
  refinementSessionStateOrdinaryArrayValueInternal,
  refinementSessionStateSetValuesInternal,
  refinementSessionStateCellFingerprintInternal,
  refinementSessionStateNodeFingerprintInternal
} from "./refinement-session-state-internal.js";
import type {
  MutableRefinementSessionCell,
  RefinementSessionStateReader,
  RefinementSessionStateWriter
} from "./refinement-session-state-internal.js";
import {
  checkpointRefinementSessionOverlayHistory,
  commitRefinementSessionOverlay,
  createRefinementSessionOverlay,
  forkRefinementSessionOverlay,
  refinementSessionOverlayStats,
  restoreRefinementSessionOverlayHistory,
  snapshotRefinementSessionOverlayDelta,
  type RefinementSessionOverlay,
  type RefinementSessionOverlayDelta,
  type RefinementSessionOverlayStats
} from "./refinement-session-overlay-internal.js";
import {
  createTransitionRebuildContextInternal,
  type ImmutableBoundaryFacePartition,
  type TransitionRebuildContext
} from "./refinement-transition-context-internal.js";

const TRUSTED_ARRAY_IS_ARRAY = Array.isArray;
const TRUSTED_ARRAY_PUSH = Array.prototype.push;
const TRUSTED_ARRAY_SORT = Array.prototype.sort;
const TRUSTED_MAP = Map;
const TRUSTED_MAP_FOR_EACH = Map.prototype.forEach;
const TRUSTED_MAP_GET = Map.prototype.get;
const TRUSTED_MAP_HAS = Map.prototype.has;
const TRUSTED_MAP_SET = Map.prototype.set;
const TRUSTED_OBJECT_FREEZE = Object.freeze;
const TRUSTED_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR =
  Object.getOwnPropertyDescriptor;
const TRUSTED_OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const TRUSTED_REFLECT_APPLY = Reflect.apply;
const TRUSTED_SET_PROTOTYPE = Set.prototype;
const TRUSTED_WEAK_SET_ADD = WeakSet.prototype.add;
const TRUSTED_WEAK_SET_HAS = WeakSet.prototype.has;

export type CellId = string;
export type RefinementSessionCellRole = "base" | RefinementRole;

/** Public cell state is read-only and changes only through session command APIs. */
export interface RefinementSessionCell {
  readonly id: CellId;
  readonly ordinal: number;
  readonly parentId?: CellId;
  readonly level: number;
  readonly role: RefinementSessionCellRole;
  readonly kind: ElementKind;
  readonly element: readonly number[];
  readonly children: readonly CellId[];
  readonly active: boolean;
  readonly hidden: boolean;
  readonly sourceElementId?: number;
  readonly template?: string;
}

/** A deeply immutable history record safe to retain across undo and redo. */
export interface RefinementSessionCommand {
  readonly id: string;
  readonly kind: "refine";
  readonly hiddenCellIds: readonly CellId[];
  readonly createdCellIds: readonly CellId[];
  readonly activeCreatedCellIds?: readonly CellId[];
  readonly reactivatedCellIds?: readonly CellId[];
  readonly createdNodeIds: readonly number[];
  readonly quality?: Readonly<HexRefinementQualitySummary>;
  readonly twoToOne?: ReadonlyTwoToOneCapabilityReport<CellId>;
  readonly recipe?: RefinementSessionCommandRecipeV1;
}

/**
 * Public session state is read-only. Mutate it through refine/undo/redo/replay
 * APIs so revision and reusable-build invalidation remain coherent.
 */
export interface RefinementSession {
  readonly revision: number;
  readonly baseMesh: ReadonlyMesh;
  readonly kind: ElementKind;
  readonly nodes: readonly Readonly<Point>[];
  readonly cells: ReadonlyMap<CellId, RefinementSessionCell>;
  readonly activeLeafIds: ReadonlySet<CellId>;
  readonly sortedActiveLeafIds: readonly CellId[];
  readonly sortedActiveLeafIdsDirty: boolean;
  readonly activeLeafIdsByNodeKey: ReadonlyMap<string, readonly CellId[]>;
  readonly undoStack: readonly RefinementSessionCommand[];
  readonly redoStack: readonly RefinementSessionCommand[];
  readonly nextCommandId: number;
  readonly nextCellOrdinal: number;
}

interface MutableRefinementSession {
  revision: number;
  baseMesh: Mesh;
  kind: ElementKind;
  nodes: Point[];
  cells: Map<CellId, MutableRefinementSessionCell>;
  activeLeafIds: Set<CellId>;
  sortedActiveLeafIds: CellId[];
  sortedActiveLeafIdsDirty: boolean;
  activeLeafIdsByNodeKey: Map<string, CellId[]>;
  undoStack: RefinementSessionCommand[];
  redoStack: RefinementSessionCommand[];
  nextCommandId: number;
  nextCellOrdinal: number;
}

export interface BuildActiveMeshOptions {
  mergeNodes?: boolean;
  mergeTolerance?: number;
  includeElementIdsByNodeId?: boolean;
  includeCellIdByElementId?: boolean;
  includeElementIdByCellId?: boolean;
  includeSessionNodeIdByNodeId?: boolean;
  includeSessionNodeIdsByNodeId?: boolean;
}

export interface ActiveMeshBuildResult {
  readonly mesh: ReadonlyMesh;
  /** Actual node-merge tolerance used to construct `mesh`; absent when nodes were not merged. */
  readonly mergeTolerance?: number;
  /** Build-time geometric resolution of the immutable `mesh` snapshot. */
  readonly geometryResolution?: ActiveMeshGeometryResolution;
  readonly provenance?: ActiveMeshBuildProvenance;
  readonly cellIdByElementId: ReadonlyMap<number, CellId>;
  readonly elementIdByCellId: ReadonlyMap<CellId, number>;
  readonly cellIdsByElementIdArray?: readonly CellId[];
  readonly elementIdByCellOrdinalArray?: Int32Array;
  readonly nodeIdBySessionNodeId: ReadonlyMap<number, number>;
  readonly sessionNodeIdByNodeId: ReadonlyMap<number, number>;
  readonly sessionNodeIdsByNodeId: ReadonlyMap<number, readonly number[]>;
  readonly elementIdsByNodeId?: ReadonlyMap<number, readonly number[]>;
}

export interface ActiveMeshGeometryResolution {
  readonly coordinateScale: number;
  readonly minimumElementEdgeLength: number;
}

export interface ActiveMeshBuildProvenance {
  readonly version: 1;
  readonly sessionRevision: number;
  readonly sessionFingerprint: string;
  readonly mappingFingerprint: string;
  readonly mergeTolerance?: number;
  readonly geometryResolution: ActiveMeshGeometryResolution;
}

interface TrustedActiveMeshBuild {
  readonly sessionToken: object;
  readonly sessionRevision: number;
  readonly mesh: ReadonlyMesh;
  readonly geometryResolution: ActiveMeshGeometryResolution;
  readonly provenance: ActiveMeshBuildProvenance;
  readonly mergeTolerance?: number;
  readonly mappings: TrustedActiveMeshMappings;
  readonly sessionGuard: TrustedSessionBuildGuard;
}

interface TrustedActiveMeshMappings {
  readonly cellIdByElementId: ReadonlyMap<number, CellId>;
  readonly elementIdByCellId: ReadonlyMap<CellId, number>;
  readonly cellIdsByElementIdArray: readonly CellId[];
  readonly elementIdByCellOrdinalArray: Int32Array;
  readonly nodeIdBySessionNodeId: ReadonlyMap<number, number>;
  readonly sessionNodeIdByNodeId: ReadonlyMap<number, number>;
  readonly sessionNodeIdsByNodeId: ReadonlyMap<number, readonly number[]>;
  readonly elementIdsByNodeId?: ReadonlyMap<number, readonly number[]>;
}

interface TrustedSessionBuildGuard {
  readonly nodes: RefinementSession["nodes"];
  readonly cells: RefinementSession["cells"];
  readonly activeLeafIds: RefinementSession["activeLeafIds"];
  readonly nodeCount: number;
  readonly cellCount: number;
  readonly activeLeafCount: number;
  readonly cellFingerprintByElementId: readonly (string | undefined)[];
}

const activeMeshBuildTrust = new WeakMap<ActiveMeshBuildResult, TrustedActiveMeshBuild>();
const activeMeshBuildMappings = new WeakMap<ActiveMeshBuildResult, TrustedActiveMeshMappings>();
const mappingOnlyActiveMeshBuilds = new WeakSet<ActiveMeshBuildResult>();
const internalActiveMeshBuildTrust = new WeakMap<
  ActiveMeshBuildResult,
  {
    readonly sessionToken: object;
    readonly sessionRevision: number;
    readonly mappings: TrustedActiveMeshMappings;
    readonly sessionGuard: TrustedSessionBuildGuard;
  }
>();
const refinementSessionTokens = new WeakMap<RefinementSession, object>();

export type RefinementSessionNamedSets<T extends string | number> =
  | ReadonlyMap<string, readonly T[]>
  | Record<string, readonly T[]>;

export interface RefinementSessionSetRemapInput {
  cellSets?: RefinementSessionNamedSets<CellId>;
  nodeSets?: RefinementSessionNamedSets<number>;
}

export interface ActiveMeshSetRemapResult {
  cellSets: Map<string, number[]>;
  nodeSets: Map<string, number[]>;
  missingCellIdsBySet: Map<string, CellId[]>;
  missingNodeIdsBySet: Map<string, number[]>;
}

export interface RefinementSessionExportOptions extends BuildActiveMeshOptions {
  sets?: RefinementSessionSetRemapInput;
}

export interface RefinementSessionExportResult {
  mesh: ReadonlyMesh;
  build: ActiveMeshBuildResult;
  sets: ActiveMeshSetRemapResult;
}

export interface RefinementSessionLocalConformanceReport {
  report: ConformanceReport;
  mesh: ReadonlyMesh;
  activeBuild: ActiveMeshBuildResult;
  checkedCellIds: CellId[];
  checkedElementIds: number[];
  seedCellIds: CellId[];
  seedElementIds: number[];
}

export interface RefinementSessionSelectionValidation {
  ok: boolean;
  cellIds: CellId[];
  level: number | undefined;
  missingCellIds: CellId[];
  inactiveCellIds: CellId[];
  transitionCellIds: CellId[];
  mixedLevelCellIds: CellId[];
  errors: string[];
}

export type LocalRefinementFactory = (vertices: Point[]) => LocalRefinement;

export interface RefinementSessionPatchOptions {
  includeTransitions?: boolean;
  hexRefinementRatio?: 2 | 3;
  hexTwoToOneSelectionMode?: "section" | "local";
  hexTwoToOneCompensation?: TwoToOneCompensationOptions;
  /**
   * Rebuild a component-local closure of replayable 2:1 history when a nested
   * local patch reaches an existing shell. Set false to preserve strict
   * collision rejection.
   */
  rebuildExistingTransitions?: boolean;
  transitionSupportCellIds?: readonly CellId[];
  mergeTolerance?: number;
  activeBuild?: ActiveMeshBuildResult;
}

/** @internal An already-validated patch plan consumed by session-state writers. */
export interface RefinementSessionPatchPlanInternal {
  sourceActive: ActiveMeshBuildResult;
  planningActive: ActiveMeshBuildResult;
  replacements: ClassifiedReplacement[];
  sourceReplacements: ClassifiedReplacement[];
  hiddenCellIds: CellId[];
  quality?: HexRefinementQualitySummary;
  twoToOne?: TwoToOneCapabilityReport<CellId>;
  recipe: RefinementSessionCommandRecipeV1;
}

const trustedRefinementSessionPatchPlans =
  new WeakSet<RefinementSessionPatchPlanInternal>();

export function createRefinementSession(mesh: ReadonlyMesh): RefinementSession {
  const kind = inferMeshKind(mesh);
  const cells = new Map<CellId, MutableRefinementSessionCell>();
  const activeLeafIds = new Set<CellId>();
  const activeLeafIdsByNodeKey = new Map<string, CellId[]>();

  mesh.elements.forEach((element, index) => {
    const id = baseCellId(index + 1);
    cells.set(id, {
      id,
      ordinal: index + 1,
      level: 0,
      role: "base",
      kind,
      element: [...element],
      children: [],
      active: true,
      hidden: false,
      sourceElementId: index + 1,
      template: "base"
    });
    activeLeafIds.add(id);
    for (const nodeId of element) {
      const point = mesh.nodes[nodeId - 1];
      if (!point) {
        throw new Error(`base cell ${id} references missing node ${nodeId}`);
      }
      const key = exactActiveMergeKey(point);
      const ownerIds = activeLeafIdsByNodeKey.get(key) ?? [];
      ownerIds.push(id);
      activeLeafIdsByNodeKey.set(key, ownerIds);
    }
  });

  return {
    revision: 0,
    baseMesh: cloneMesh(mesh),
    kind,
    nodes: mesh.nodes.map((point) => [...point]),
    cells,
    activeLeafIds,
    sortedActiveLeafIds: [...activeLeafIds],
    sortedActiveLeafIdsDirty: false,
    activeLeafIdsByNodeKey,
    undoStack: [],
    redoStack: [],
    nextCommandId: 1,
    nextCellOrdinal: mesh.elements.length + 1
  };
}

export function buildActiveMesh(
  session: RefinementSession,
  options: BuildActiveMeshOptions = {}
): ReadonlyMesh {
  return buildActiveMeshWithMap(session, options).mesh;
}

export function buildActiveMeshWithMap(
  session: RefinementSession,
  options: BuildActiveMeshOptions = {}
): ActiveMeshBuildResult {
  assertValidSessionFaceTolerance(options.mergeTolerance);
  return buildActiveMeshForCellIdsWithMap(session, sortedActiveLeafIds(session), options);
}

/** @internal Build an active mesh from a sparse session-state reader. */
export function buildActiveMeshWithMapFromSessionStateInternal(
  state: RefinementSessionStateReader,
  options: BuildActiveMeshOptions = {}
): ActiveMeshBuildResult {
  assertValidSessionFaceTolerance(options.mergeTolerance);
  return buildActiveMeshForSessionStateCellIdsWithMap(
    state,
    sortedActiveLeafIdsFromSessionState(state),
    options,
    undefined,
    (result, mergeTolerance, measuredResolution) =>
      finalizeActiveMeshBuildFromSessionState(
        result,
        mergeTolerance,
        measuredResolution
      )
  );
}

function buildActiveMeshForStateCellIdsWithMap(
  state: RefinementSessionStateReader,
  activeIds: readonly CellId[],
  options: BuildActiveMeshOptions,
  geometryResolution: ActiveMeshGeometryResolution
): ActiveMeshBuildResult {
  return buildActiveMeshForSessionStateCellIdsWithMap(
    state,
    activeIds,
    options,
    undefined,
    (result, mergeTolerance) =>
      finalizeActiveMeshBuildFromSessionState(
        result,
        mergeTolerance,
        geometryResolution
      )
  );
}

function buildActiveMeshForCellIdsWithMap(
  session: RefinementSession,
  activeIds: readonly CellId[],
  options: BuildActiveMeshOptions = {},
  resolveDefaultMergeTolerance?: (resolution: ActiveMeshGeometryResolution) => number,
  includeProvenance = true,
  includeGeometryResolution = true
): ActiveMeshBuildResult {
  const state = createDirectRefinementSessionState(session, exactActiveMergeKey);
  return buildActiveMeshForSessionStateCellIdsWithMap(
    state,
    activeIds,
    options,
    resolveDefaultMergeTolerance,
    (result, mergeTolerance, measuredResolution) => finalizeActiveMeshBuild(
      result,
      session,
      activeIds,
      mergeTolerance,
      measuredResolution,
      includeProvenance,
      includeGeometryResolution
    )
  );
}

type ActiveMeshBuildFinalizer = (
  result: ActiveMeshBuildResult,
  mergeTolerance?: number,
  measuredResolution?: ActiveMeshGeometryResolution
) => ActiveMeshBuildResult;

function buildActiveMeshForSessionStateCellIdsWithMap(
  state: RefinementSessionStateReader,
  activeIds: readonly CellId[],
  options: BuildActiveMeshOptions,
  resolveDefaultMergeTolerance: (
    (resolution: ActiveMeshGeometryResolution) => number
  ) | undefined,
  finalize: ActiveMeshBuildFinalizer
): ActiveMeshBuildResult {
  const includeSessionNodeIdByNodeId = options.includeSessionNodeIdByNodeId ?? true;
  const includeSessionNodeIdsByNodeId = options.includeSessionNodeIdsByNodeId ?? true;
  const includeCellIdByElementId = options.includeCellIdByElementId ?? true;
  const includeElementIdByCellId = options.includeElementIdByCellId ?? true;
  const includeReverseNodeMaps = includeSessionNodeIdByNodeId || includeSessionNodeIdsByNodeId;
  if (options.mergeNodes && options.mergeTolerance !== undefined) {
    return buildMergedActiveMeshDirect(
      state,
      activeIds,
      options,
      includeSessionNodeIdByNodeId,
      includeSessionNodeIdsByNodeId,
      includeCellIdByElementId,
      includeElementIdByCellId,
      finalize
    );
  }
  const compactNodeIdBySessionNodeId = new Map<number, number>();
  const sessionNodeIdByCompactNodeId = includeReverseNodeMaps ? new Map<number, number>() : undefined;
  const sessionNodeIdsByCompactNodeId = includeSessionNodeIdsByNodeId ? new Map<number, number[]>() : undefined;
  const nodes: Point[] = [];
  const compactNodeId = (sessionNodeId: number, cellId: CellId): number => {
    const mapped = compactNodeIdBySessionNodeId.get(sessionNodeId);
    if (mapped !== undefined) {
      return mapped;
    }
    const node = activeSessionStateNode(state, sessionNodeId, cellId);
    const nextNodeId = nodes.length + 1;
    compactNodeIdBySessionNodeId.set(sessionNodeId, nextNodeId);
    sessionNodeIdByCompactNodeId?.set(nextNodeId, sessionNodeId);
    sessionNodeIdsByCompactNodeId?.set(nextNodeId, [sessionNodeId]);
    TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, nodes, [
      snapshotPlanningArray<number>(node, `node ${sessionNodeId}`) as Point
    ]);
    return nextNodeId;
  };

  const activeIdCount = planningArrayLength(
    activeIds,
    "reader planning active cell ids"
  );
  const cellIdByElementId = new Map<number, CellId>();
  const elementIdByCellId = new Map<CellId, number>();
  const cellIdsByElementIdArray: CellId[] = new Array(activeIdCount + 1);
  const elementIdByCellOrdinalArray = new Int32Array(
    localCellOrdinalArrayLength(state, activeIds, activeIdCount)
  );
  const elements: Element[] = new Array(activeIdCount);
  for (let index = 0; index < activeIdCount; index += 1) {
    const cellId = planningArrayValue<CellId>(
      activeIds,
      index,
      "reader planning active cell ids"
    );
    const elementId = index + 1;
    const cell = requiredSessionStateCell(state, cellId);
    if (includeCellIdByElementId) {
      cellIdByElementId.set(elementId, cellId);
    }
    cellIdsByElementIdArray[elementId] = cellId;
    if (includeElementIdByCellId) {
      elementIdByCellId.set(cellId, elementId);
    }
    recordActiveElementByCellOrdinal(elementIdByCellOrdinalArray, cell, elementId);
    const nodeCount = planningArrayLength(
      cell.element,
      `cell ${cellId}.element`
    );
    const element = new Array<number>(nodeCount);
    for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
      element[nodeIndex] = compactNodeId(
        planningArrayValue<number>(
          cell.element,
          nodeIndex,
          `cell ${cellId}.element`
        ),
        cellId
      );
    }
    elements[index] = element;
  }

  const mesh: Mesh = { kind: state.kind, nodes, elements };
  if (!options.mergeNodes) {
    const result: ActiveMeshBuildResult = {
      mesh,
      cellIdByElementId,
      elementIdByCellId,
      cellIdsByElementIdArray,
      elementIdByCellOrdinalArray,
      nodeIdBySessionNodeId: compactNodeIdBySessionNodeId,
      sessionNodeIdByNodeId: sessionNodeIdByCompactNodeId ?? new Map<number, number>(),
      sessionNodeIdsByNodeId: sessionNodeIdsByCompactNodeId ?? new Map<number, number[]>()
    };
    if (options.includeElementIdsByNodeId) {
      setElementIdsByNodeId(result, buildElementIdsByNodeId(mesh.elements));
    }
    return finalize(
      result,
      undefined,
      undefined
    );
  }

  const measuredResolution = options.mergeTolerance === undefined
    ? measureActiveMeshGeometryResolution(mesh)
    : undefined;
  const mergeTolerance = options.mergeTolerance
    ?? resolveDefaultMergeTolerance?.(measuredResolution!)
    ?? measuredResolution!.minimumElementEdgeLength * 0.0005;
  const merged = mergeCoincidentNodesWithMap(mesh, mergeTolerance);
  const nodeIdBySessionNodeId = new Map<number, number>();
  const sessionNodeIdByNodeId = includeSessionNodeIdByNodeId ? new Map<number, number>() : undefined;
  const sessionNodeIdsByNodeId = includeSessionNodeIdsByNodeId ? new Map<number, number[]>() : undefined;

  for (const [sessionNodeId, compactNodeId] of compactNodeIdBySessionNodeId) {
    const mergedNodeId = merged.nodeIdByInputNodeIdArray?.[compactNodeId] ?? merged.nodeIdByInputNodeId.get(compactNodeId);
    if (mergedNodeId === undefined) {
      throw new Error(`missing merged node id for active node ${compactNodeId}`);
    }
    nodeIdBySessionNodeId.set(sessionNodeId, mergedNodeId);
  }
  if (includeReverseNodeMaps) {
    const mergedInputGroups = merged.inputNodeIdsByNodeIdArray
      ? merged.inputNodeIdsByNodeIdArray.entries()
      : merged.inputNodeIdsByNodeId.entries();
    for (const [mergedNodeId, compactNodeIds] of mergedInputGroups) {
      if (!compactNodeIds || compactNodeIds.length === 0) {
        continue;
      }
      const sessionNodeIds = compactNodeIds.map((compactNodeId) => {
        const sessionNodeId = sessionNodeIdByCompactNodeId!.get(compactNodeId);
        if (sessionNodeId === undefined) {
          throw new Error(`missing session node id for active node ${compactNodeId}`);
        }
        return sessionNodeId;
      });
      sessionNodeIdByNodeId?.set(mergedNodeId, sessionNodeIds[0]!);
      sessionNodeIdsByNodeId?.set(mergedNodeId, sessionNodeIds);
    }
  }

  const result: ActiveMeshBuildResult = {
    mesh: merged.mesh,
    cellIdByElementId,
    elementIdByCellId,
    cellIdsByElementIdArray,
    elementIdByCellOrdinalArray,
    nodeIdBySessionNodeId,
    sessionNodeIdByNodeId: sessionNodeIdByNodeId ?? new Map<number, number>(),
    sessionNodeIdsByNodeId: sessionNodeIdsByNodeId ?? new Map<number, number[]>()
  };
  if (options.includeElementIdsByNodeId) {
    setElementIdsByNodeId(result, buildElementIdsByNodeId(merged.mesh.elements));
  }
  return finalize(
    result,
    mergeTolerance,
    measuredResolution
  );
}

function buildMergedActiveMeshDirect(
  state: RefinementSessionStateReader,
  activeIds: readonly CellId[],
  options: BuildActiveMeshOptions,
  includeSessionNodeIdByNodeId: boolean,
  includeSessionNodeIdsByNodeId: boolean,
  includeCellIdByElementId: boolean,
  includeElementIdByCellId: boolean,
  finalize: ActiveMeshBuildFinalizer
): ActiveMeshBuildResult {
  const tolerance = options.mergeTolerance!;
  const auditNodes: Point[] = [];
  const auditNodeIdBySessionNodeId = new Map<number, number>();
  const activePointBySessionNodeId = new Map<number, Point>();
  const activeIdCount = planningArrayLength(
    activeIds,
    "reader merged planning active cell ids"
  );
  const auditElements: Element[] = new Array(activeIdCount);
  for (let index = 0; index < activeIdCount; index += 1) {
    const cellId = planningArrayValue<CellId>(
      activeIds,
      index,
      "reader merged planning active cell ids"
    );
    const cell = requiredSessionStateCell(state, cellId);
    const nodeCount = planningArrayLength(
      cell.element,
      `cell ${cellId}.element`
    );
    const auditElement = new Array<number>(nodeCount);
    for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
      const sessionNodeId = planningArrayValue<number>(
        cell.element,
        nodeIndex,
        `cell ${cellId}.element`
      );
      const existing = auditNodeIdBySessionNodeId.get(sessionNodeId);
      if (existing !== undefined) {
        auditElement[nodeIndex] = existing;
        continue;
      }
      const point = activeSessionStateNode(state, sessionNodeId, cellId);
      const auditNodeId = auditNodes.length + 1;
      TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, auditNodes, [point]);
      auditNodeIdBySessionNodeId.set(sessionNodeId, auditNodeId);
      activePointBySessionNodeId.set(sessionNodeId, point);
      auditElement[nodeIndex] = auditNodeId;
    }
    auditElements[index] = auditElement;
  }
  assertMergeToleranceBelowFinalEdgeLimit(
    {
      kind: state.kind,
      nodes: auditNodes,
      elements: auditElements
    },
    tolerance
  );
  const nodes: Point[] = [];
  const elements: Element[] = new Array(activeIdCount);
  const cellIdByElementId = new Map<number, CellId>();
  const elementIdByCellId = new Map<CellId, number>();
  const cellIdsByElementIdArray: CellId[] = new Array(activeIdCount + 1);
  const elementIdByCellOrdinalArray = new Int32Array(
    localCellOrdinalArrayLength(state, activeIds, activeIdCount)
  );
  const nodeIdBySessionNodeId = new Map<number, number>();
  const sessionNodeIdByNodeId = includeSessionNodeIdByNodeId ? new Map<number, number>() : undefined;
  const sessionNodeIdsByNodeId = includeSessionNodeIdsByNodeId ? new Map<number, number[]>() : undefined;
  const exactNodeIndexByKey = tolerance === 0 ? new Map<string, number>() : undefined;
  const buckets = tolerance === 0 ? undefined : new Map<string, number[]>();
  const bucketLayout = createMergeBucketLayout(auditNodes, tolerance);

  for (let index = 0; index < activeIdCount; index += 1) {
    const cellId = planningArrayValue<CellId>(
      activeIds,
      index,
      "reader merged planning active cell ids"
    );
    const elementId = index + 1;
    const cell = requiredSessionStateCell(state, cellId);
    if (includeCellIdByElementId) {
      cellIdByElementId.set(elementId, cellId);
    }
    cellIdsByElementIdArray[elementId] = cellId;
    if (includeElementIdByCellId) {
      elementIdByCellId.set(cellId, elementId);
    }
    recordActiveElementByCellOrdinal(elementIdByCellOrdinalArray, cell, elementId);
    const sourceElement = cell.element;
    const sourceElementLength = planningArrayLength(
      sourceElement,
      `cell ${cellId}.element`
    );
    const mappedElement = new Array<number>(sourceElementLength);
    for (let nodeOffset = 0; nodeOffset < sourceElementLength; nodeOffset += 1) {
      const sessionNodeId = planningArrayValue<number>(
        sourceElement,
        nodeOffset,
        `cell ${cellId}.element`
      );
      let nodeId = nodeIdBySessionNodeId.get(sessionNodeId);
      if (nodeId === undefined) {
        const point = activePointBySessionNodeId.get(sessionNodeId)
          ?? activeSessionStateNode(state, sessionNodeId, cellId);
        let nodeIndex: number | undefined;
        if (exactNodeIndexByKey) {
          const exactKey = exactReaderActiveMergeKey(point);
          const exactCandidateIndex = exactNodeIndexByKey.get(exactKey);
          nodeIndex = exactCandidateIndex !== undefined
            && pointEquals(nodes[exactCandidateIndex]!, point, 0)
            ? exactCandidateIndex
            : undefined;
          if (nodeIndex === undefined) {
            nodeIndex = nodes.length;
            TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, nodes, [
              snapshotPlanningArray<number>(
                point,
                `node ${sessionNodeId}`
              ) as Point
            ]);
            exactNodeIndexByKey.set(exactKey, nodeIndex);
          }
        } else if (buckets) {
          nodeIndex = findMergedActiveNodeIndex(
            point,
            nodes,
            buckets,
            bucketLayout,
            tolerance
          );
          if (nodeIndex === undefined) {
            nodeIndex = nodes.length;
            TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, nodes, [
              snapshotPlanningArray<number>(
                point,
                `node ${sessionNodeId}`
              ) as Point
            ]);
            addActiveMergeBucket(
              point,
              nodeIndex,
              buckets,
              bucketLayout,
              tolerance
            );
          }
        } else {
          nodeIndex = nodes.length;
          TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, nodes, [
            snapshotPlanningArray<number>(
              point,
              `node ${sessionNodeId}`
            ) as Point
          ]);
        }
        nodeId = nodeIndex! + 1;
        nodeIdBySessionNodeId.set(sessionNodeId, nodeId);
        if (sessionNodeIdByNodeId && !sessionNodeIdByNodeId.has(nodeId)) {
          sessionNodeIdByNodeId.set(nodeId, sessionNodeId);
        }
        if (sessionNodeIdsByNodeId) {
          const sessionNodeIds = sessionNodeIdsByNodeId.get(nodeId) ?? [];
          sessionNodeIds.push(sessionNodeId);
          sessionNodeIdsByNodeId.set(nodeId, sessionNodeIds);
        }
      }
      mappedElement[nodeOffset] = nodeId!;
    }
    elements[index] = mappedElement;
  }

  const mesh: Mesh = { kind: state.kind, nodes, elements };
  const result: ActiveMeshBuildResult = {
    mesh,
    cellIdByElementId,
    elementIdByCellId,
    cellIdsByElementIdArray,
    elementIdByCellOrdinalArray,
    nodeIdBySessionNodeId,
    sessionNodeIdByNodeId: sessionNodeIdByNodeId ?? new Map<number, number>(),
    sessionNodeIdsByNodeId: sessionNodeIdsByNodeId ?? new Map<number, number[]>()
  };
  if (options.includeElementIdsByNodeId) {
    setElementIdsByNodeId(result, buildElementIdsByNodeId(elements));
  }
  return finalize(
    result,
    tolerance,
    undefined
  );
}

interface PreparedActiveMeshBuild {
  readonly mesh: ReadonlyMesh;
  readonly geometryResolution?: ActiveMeshGeometryResolution;
  readonly mappings: TrustedActiveMeshMappings;
}

function prepareActiveMeshBuild(
  result: ActiveMeshBuildResult,
  mergeTolerance?: number,
  measuredResolution?: ActiveMeshGeometryResolution,
  includeProvenance = true,
  includeGeometryResolution = true
): PreparedActiveMeshBuild {
  const mesh = freezeActiveMesh(result.mesh);
  const geometryResolution = measuredResolution === undefined
    && !includeProvenance
    && !includeGeometryResolution
    && mergeTolerance !== undefined
      ? undefined
      : Object.freeze(measuredResolution ?? measureActiveMeshGeometryResolution(mesh));
  if (mergeTolerance !== undefined) {
    Object.defineProperty(result, "mergeTolerance", {
      configurable: false,
      enumerable: true,
      value: mergeTolerance,
      writable: false
    });
  }
  if (geometryResolution !== undefined) {
    Object.defineProperty(result, "geometryResolution", {
      configurable: false,
      enumerable: true,
      value: geometryResolution,
      writable: false
    });
  }
  const mappings = snapshotTrustedActiveMeshMappings(result);
  activeMeshBuildMappings.set(result, mappings);
  return {
    mesh,
    ...(geometryResolution === undefined ? {} : { geometryResolution }),
    mappings
  };
}

function finalizeActiveMeshBuildFromSessionState(
  result: ActiveMeshBuildResult,
  mergeTolerance?: number,
  measuredResolution?: ActiveMeshGeometryResolution,
  includeGeometryResolution = true
): ActiveMeshBuildResult {
  prepareActiveMeshBuild(
    result,
    mergeTolerance,
    measuredResolution,
    false,
    includeGeometryResolution
  );
  mappingOnlyActiveMeshBuilds.add(result);
  return result;
}

function finalizeActiveMeshBuild(
  result: ActiveMeshBuildResult,
  session: RefinementSession,
  activeIds: readonly CellId[],
  mergeTolerance?: number,
  measuredResolution?: ActiveMeshGeometryResolution,
  includeProvenance = true,
  includeGeometryResolution = true
): ActiveMeshBuildResult {
  const { mesh, geometryResolution, mappings } = prepareActiveMeshBuild(
    result,
    mergeTolerance,
    measuredResolution,
    includeProvenance,
    includeGeometryResolution
  );
  const sessionGuard = createTrustedSessionBuildGuard(session, activeIds);
  if (!includeProvenance) {
    internalActiveMeshBuildTrust.set(result, Object.freeze({
      sessionToken: refinementSessionToken(session),
      sessionRevision: session.revision,
      mappings,
      sessionGuard
    }));
    return result;
  }
  if (geometryResolution === undefined) {
    throw new Error("public active mesh builds require geometry resolution metadata");
  }
  const provenance: ActiveMeshBuildProvenance = Object.freeze({
    version: 1,
    sessionRevision: session.revision,
    sessionFingerprint: refinementSessionFingerprint(session),
    mappingFingerprint: activeMeshBuildMappingFingerprint(result),
    ...(mergeTolerance === undefined ? {} : { mergeTolerance }),
    geometryResolution
  });
  Object.defineProperty(result, "provenance", {
    configurable: false,
    enumerable: true,
    value: provenance,
    writable: false
  });
  lockActiveMeshBuildMappings(result);
  Object.freeze(result);
  activeMeshBuildTrust.set(result, Object.freeze({
    sessionToken: refinementSessionToken(session),
    sessionRevision: session.revision,
    mesh,
    geometryResolution,
    provenance,
    mappings,
    sessionGuard,
    ...(mergeTolerance === undefined ? {} : { mergeTolerance })
  }));
  return result;
}

function setElementIdsByNodeId(
  result: ActiveMeshBuildResult,
  elementIdsByNodeId: Map<number, number[]>
): void {
  Object.defineProperty(result, "elementIdsByNodeId", {
    configurable: true,
    enumerable: true,
    value: elementIdsByNodeId,
    writable: true
  });
}

function snapshotTrustedActiveMeshMappings(
  build: ActiveMeshBuildResult
): TrustedActiveMeshMappings {
  const cellIdsByElementIdArray = build.cellIdsByElementIdArray === undefined
    ? []
    : build.cellIdsByElementIdArray.slice();
  Object.freeze(cellIdsByElementIdArray);
  const cellIdByElementId = new Map<number, CellId>();
  const elementIdByCellId = new Map<CellId, number>();
  for (let elementId = 1; elementId < cellIdsByElementIdArray.length; elementId += 1) {
    if (!Object.prototype.hasOwnProperty.call(cellIdsByElementIdArray, elementId)) {
      continue;
    }
    const cellId = cellIdsByElementIdArray[elementId];
    if (typeof cellId !== "string") {
      continue;
    }
    cellIdByElementId.set(elementId, cellId);
    elementIdByCellId.set(cellId, elementId);
  }
  const copyNumberMap = (
    source: ReadonlyMap<number, number>
  ): ReadonlyMap<number, number> => new Map(source);
  const copyNumberArrayMap = (
    source: ReadonlyMap<number, readonly number[]>
  ): ReadonlyMap<number, readonly number[]> => new Map(
    [...source].map(([key, values]) => [key, Object.freeze([...values])])
  );
  return Object.freeze({
    cellIdByElementId,
    elementIdByCellId,
    cellIdsByElementIdArray,
    elementIdByCellOrdinalArray: build.elementIdByCellOrdinalArray === undefined
      ? new Int32Array()
      : new Int32Array(build.elementIdByCellOrdinalArray),
    nodeIdBySessionNodeId: copyNumberMap(build.nodeIdBySessionNodeId),
    sessionNodeIdByNodeId: copyNumberMap(build.sessionNodeIdByNodeId),
    sessionNodeIdsByNodeId: copyNumberArrayMap(build.sessionNodeIdsByNodeId),
    ...(build.elementIdsByNodeId === undefined
      ? {}
      : { elementIdsByNodeId: copyNumberArrayMap(build.elementIdsByNodeId) })
  });
}

function freezeActiveMesh(mesh: ReadonlyMesh): ReadonlyMesh {
  for (const point of mesh.nodes) {
    Object.freeze(point);
  }
  for (const element of mesh.elements) {
    Object.freeze(element);
  }
  Object.freeze(mesh.nodes);
  Object.freeze(mesh.elements);
  return Object.freeze(mesh);
}

function refinementSessionToken(session: RefinementSession): object {
  let token = refinementSessionTokens.get(session);
  if (token === undefined) {
    token = {};
    refinementSessionTokens.set(session, token);
  }
  return token;
}

class StableFingerprint {
  private first = 0x811c9dc5;
  private second = 0x9e3779b9;
  private readonly numberBytes = new DataView(new ArrayBuffer(8));

  addByte(value: number): void {
    this.first = Math.imul(this.first ^ value, 0x01000193) >>> 0;
    this.second = Math.imul(this.second ^ value, 0x85ebca6b) >>> 0;
  }

  addUint32(value: number): void {
    for (let shift = 24; shift >= 0; shift -= 8) {
      this.addByte((value >>> shift) & 0xff);
    }
  }

  addString(value: string): void {
    this.addUint32(value.length);
    for (let index = 0; index < value.length; index += 1) {
      this.addUint32(value.charCodeAt(index));
    }
  }

  addNumber(value: number): void {
    this.numberBytes.setFloat64(0, value, false);
    for (let index = 0; index < 8; index += 1) {
      this.addByte(this.numberBytes.getUint8(index));
    }
  }

  digest(): string {
    return `${this.first.toString(16).padStart(8, "0")}${this.second.toString(16).padStart(8, "0")}`;
  }
}

function addStableValue(
  fingerprint: StableFingerprint,
  value: unknown
): void {
  if (value === undefined) {
    fingerprint.addByte(0);
  } else if (value === null) {
    fingerprint.addByte(1);
  } else if (typeof value === "boolean") {
    fingerprint.addByte(value ? 3 : 2);
  } else if (typeof value === "number") {
    fingerprint.addByte(4);
    fingerprint.addNumber(value);
  } else if (typeof value === "string") {
    fingerprint.addByte(5);
    fingerprint.addString(value);
  } else if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    fingerprint.addByte(Array.isArray(value) ? 6 : 7);
    const array = value as ArrayLike<unknown>;
    fingerprint.addUint32(array.length);
    for (let index = 0; index < array.length; index += 1) {
      if (Array.isArray(value) && !Object.prototype.hasOwnProperty.call(value, index)) {
        fingerprint.addByte(8);
      } else {
        fingerprint.addByte(9);
        addStableValue(fingerprint, array[index]);
      }
    }
  } else {
    throw new TypeError(`unsupported active build fingerprint value: ${typeof value}`);
  }
}

function addStableMap(
  fingerprint: StableFingerprint,
  map: ReadonlyMap<number | string, unknown>
): void {
  fingerprint.addByte(10);
  fingerprint.addUint32(map.size);
  for (const [key, value] of map) {
    addStableValue(fingerprint, key);
    addStableValue(fingerprint, value);
  }
}

function refinementSessionFingerprint(session: RefinementSession): string {
  const fingerprint = new StableFingerprint();
  addStableValue(fingerprint, session.kind);
  addStableValue(fingerprint, session.nodes);
  const cellsByOrdinal = refinementSessionCellsByOrdinal(session);
  addStableValue(fingerprint, session.activeLeafIds.size);
  fingerprint.addUint32(cellsByOrdinal.length - 1);
  for (let ordinal = 1; ordinal < cellsByOrdinal.length; ordinal += 1) {
    const entry = cellsByOrdinal[ordinal]!;
    const { cellId, cell } = entry;
    addStableValue(fingerprint, cellId);
    addStableValue(fingerprint, cell.id);
    addStableValue(fingerprint, cell.ordinal);
    addStableValue(fingerprint, cell.parentId);
    addStableValue(fingerprint, cell.level);
    addStableValue(fingerprint, cell.role);
    addStableValue(fingerprint, cell.kind);
    addStableValue(fingerprint, cell.element);
    addStableValue(fingerprint, cell.children);
    addStableValue(fingerprint, cell.active);
    addStableValue(fingerprint, cell.hidden);
    addStableValue(fingerprint, cell.sourceElementId);
    addStableValue(fingerprint, cell.template);
    addStableValue(fingerprint, session.activeLeafIds.has(cellId));
  }
  addStableValue(fingerprint, session.nextCellOrdinal);
  return fingerprint.digest();
}

function refinementSessionCellFingerprint(
  session: RefinementSession,
  cellId: CellId,
  cell: RefinementSessionCell
): string {
  const fingerprint = new StableFingerprint();
  addStableValue(fingerprint, cellId);
  addStableValue(fingerprint, cell.id);
  addStableValue(fingerprint, cell.ordinal);
  addStableValue(fingerprint, cell.parentId);
  addStableValue(fingerprint, cell.level);
  addStableValue(fingerprint, cell.role);
  addStableValue(fingerprint, cell.kind);
  addStableValue(fingerprint, cell.element);
  addStableValue(fingerprint, cell.children);
  addStableValue(fingerprint, cell.active);
  addStableValue(fingerprint, cell.hidden);
  addStableValue(fingerprint, cell.sourceElementId);
  addStableValue(fingerprint, cell.template);
  addStableValue(fingerprint, session.activeLeafIds.has(cellId));
  for (const nodeId of cell.element) {
    const point = session.nodes[nodeId - 1];
    if (point === undefined) {
      throw new RangeError(`cell ${cellId} references missing node ${nodeId}`);
    }
    addStableValue(fingerprint, point);
  }
  return fingerprint.digest();
}

function refinementSessionStateCellFingerprint(
  state: RefinementSessionStateReader,
  cellId: CellId,
  cell: RefinementSessionCell
): string {
  const fingerprint = new StableFingerprint();
  addStableValue(fingerprint, cellId);
  addStableValue(fingerprint, cell.id);
  addStableValue(fingerprint, cell.ordinal);
  addStableValue(fingerprint, cell.parentId);
  addStableValue(fingerprint, cell.level);
  addStableValue(fingerprint, cell.role);
  addStableValue(fingerprint, cell.kind);
  addStableValue(fingerprint, cell.element);
  addStableValue(fingerprint, cell.children);
  addStableValue(fingerprint, cell.active);
  addStableValue(fingerprint, cell.hidden);
  addStableValue(fingerprint, cell.sourceElementId);
  addStableValue(fingerprint, cell.template);
  addStableValue(fingerprint, state.hasActiveLeaf(cellId));
  const nodeCount = planningArrayLength(
    cell.element,
    `cell ${cellId}.element`
  );
  for (let index = 0; index < nodeCount; index += 1) {
    const nodeId = planningArrayValue<number>(
      cell.element,
      index,
      `cell ${cellId}.element`
    );
    const point = Number.isSafeInteger(nodeId)
      && nodeId > 0
      && nodeId <= state.nodeCount
        ? state.peekNode(nodeId)
        : undefined;
    if (point === undefined) {
      throw new RangeError(`cell ${cellId} references missing node ${nodeId}`);
    }
    addStableValue(fingerprint, point);
  }
  return fingerprint.digest();
}

function createTrustedSessionBuildGuard(
  session: RefinementSession,
  cellIdsByElementId: readonly CellId[]
): TrustedSessionBuildGuard {
  const cellFingerprintByElementId: Array<string | undefined> =
    new Array(cellIdsByElementId.length + 1);
  for (let index = 0; index < cellIdsByElementId.length; index += 1) {
    const cellId = cellIdsByElementId[index]!;
    const cell = session.cells.get(cellId);
    if (cell === undefined) {
      throw new RangeError(`active cell ${cellId} does not exist`);
    }
    cellFingerprintByElementId[index + 1] =
      refinementSessionCellFingerprint(session, cellId, cell);
  }
  Object.freeze(cellFingerprintByElementId);
  return Object.freeze({
    nodes: session.nodes,
    cells: session.cells,
    activeLeafIds: session.activeLeafIds,
    nodeCount: session.nodes.length,
    cellCount: session.cells.size,
    activeLeafCount: session.activeLeafIds.size,
    cellFingerprintByElementId
  });
}

function createTrustedSessionBuildGuardFromMappings(
  session: RefinementSession,
  mappings: TrustedActiveMeshMappings
): TrustedSessionBuildGuard {
  const cellIds: CellId[] = [];
  for (
    let elementId = 1;
    elementId < mappings.cellIdsByElementIdArray.length;
    elementId += 1
  ) {
    const cellId = mappings.cellIdsByElementIdArray[elementId];
    if (cellId !== undefined) {
      cellIds.push(cellId);
    }
  }
  return createTrustedSessionBuildGuard(session, cellIds);
}

function refinementSessionCellsByOrdinal(
  session: RefinementSession
): Array<{ readonly cellId: CellId; readonly cell: RefinementSessionCell } | undefined> {
  const cellsByOrdinal: Array<
    { readonly cellId: CellId; readonly cell: RefinementSessionCell } | undefined
  > = new Array(session.cells.size + 1);
  for (const [cellId, cell] of session.cells) {
    if (
      !isValidCellOrdinal(cell.ordinal)
      || cell.ordinal > session.cells.size
      || cellsByOrdinal[cell.ordinal] !== undefined
    ) {
      throw new RangeError(`cell ${cellId} has invalid or duplicate ordinal ${cell.ordinal}`);
    }
    cellsByOrdinal[cell.ordinal] = { cellId, cell };
  }
  for (let ordinal = 1; ordinal < cellsByOrdinal.length; ordinal += 1) {
    if (cellsByOrdinal[ordinal] === undefined) {
      throw new RangeError(`refinement session is missing cell ordinal ${ordinal}`);
    }
  }
  return cellsByOrdinal;
}

function activeMeshBuildMappingFingerprint(build: ActiveMeshBuildResult): string {
  const fingerprint = new StableFingerprint();
  addStableValue(fingerprint, build.mergeTolerance);
  addStableValue(fingerprint, build.geometryResolution?.coordinateScale);
  addStableValue(fingerprint, build.geometryResolution?.minimumElementEdgeLength);
  addStableValue(fingerprint, build.mesh.kind);
  addStableValue(fingerprint, build.mesh.nodes);
  addStableValue(fingerprint, build.mesh.elements);
  addStableMap(fingerprint, build.cellIdByElementId);
  addStableMap(fingerprint, build.elementIdByCellId);
  addStableValue(fingerprint, build.cellIdsByElementIdArray);
  addStableValue(fingerprint, build.elementIdByCellOrdinalArray);
  addStableMap(fingerprint, build.nodeIdBySessionNodeId);
  addStableMap(fingerprint, build.sessionNodeIdByNodeId);
  addStableMap(fingerprint, build.sessionNodeIdsByNodeId);
  if (build.elementIdsByNodeId === undefined) {
    addStableValue(fingerprint, undefined);
  } else {
    addStableMap(fingerprint, build.elementIdsByNodeId);
  }
  return fingerprint.digest();
}

function lockMap<K, V>(map: Map<K, V>): void {
  const immutable = (): never => {
    throw new TypeError("active build mappings are immutable");
  };
  Object.defineProperties(map, {
    set: { configurable: false, value: immutable, writable: false },
    delete: { configurable: false, value: immutable, writable: false },
    clear: { configurable: false, value: immutable, writable: false }
  });
  Object.freeze(map);
}

function lockActiveMeshBuildMappings(build: ActiveMeshBuildResult): void {
  const maps: Array<ReadonlyMap<unknown, unknown>> = [
    build.cellIdByElementId,
    build.elementIdByCellId,
    build.nodeIdBySessionNodeId,
    build.sessionNodeIdByNodeId,
    build.sessionNodeIdsByNodeId
  ];
  if (build.elementIdsByNodeId !== undefined) {
    maps.push(build.elementIdsByNodeId);
  }
  for (const values of build.sessionNodeIdsByNodeId.values()) {
    Object.freeze(values);
  }
  for (const values of build.elementIdsByNodeId?.values() ?? []) {
    Object.freeze(values);
  }
  if (build.cellIdsByElementIdArray !== undefined) {
    Object.freeze(build.cellIdsByElementIdArray);
  }
  for (const map of maps) {
    lockMap(map as Map<unknown, unknown>);
  }
}

function activeBuildProvenanceForValidation(
  build: ActiveMeshBuildResult,
  diagnosticCellIds: readonly CellId[]
): ActiveMeshBuildProvenance {
  const provenance = build.provenance;
  if (
    provenance === undefined
    || provenance.version !== 1
    || !Number.isSafeInteger(provenance.sessionRevision)
    || provenance.sessionRevision < 0
    || build.geometryResolution === undefined
    || build.geometryResolution !== provenance.geometryResolution
    || !Object.is(build.mergeTolerance, provenance.mergeTolerance)
  ) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      "external activeBuild metadata or mappings were tampered with"
    );
  }
  return provenance;
}

function ensureTrustedActiveMeshMappings(
  build: ActiveMeshBuildResult,
  diagnosticCellIds: readonly CellId[] = []
): TrustedActiveMeshMappings {
  const trusted = activeMeshBuildMappings.get(build);
  if (trusted !== undefined) {
    return trusted;
  }
  const provenance = activeBuildProvenanceForValidation(build, diagnosticCellIds);
  let mappingFingerprint: string;
  let mappings: TrustedActiveMeshMappings;
  try {
    mappingFingerprint = activeMeshBuildMappingFingerprint(build);
    mappings = snapshotTrustedActiveMeshMappings(build);
  } catch (error) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      error instanceof Error
        ? `external activeBuild validation failed: ${error.message}`
        : "external activeBuild validation failed"
    );
  }
  if (provenance.mappingFingerprint !== mappingFingerprint) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      "external activeBuild mapping fingerprint indicates tampering"
    );
  }
  Object.freeze(build.geometryResolution);
  Object.freeze(provenance);
  freezeActiveMesh(build.mesh);
  lockActiveMeshBuildMappings(build);
  Object.freeze(build);
  activeMeshBuildMappings.set(build, mappings);
  return mappings;
}

function measureActiveMeshGeometryResolution(
  mesh: ReadonlyMesh,
  measuredMinimumEdge?: number
): ActiveMeshGeometryResolution {
  let coordinateScale = 1;
  for (const point of mesh.nodes) {
    for (const coordinate of point) {
      if (!Number.isFinite(coordinate)) {
        throw new Error(
          "cannot compute effective session face tolerance from a non-finite coordinate"
        );
      }
      coordinateScale = Math.max(coordinateScale, Math.abs(coordinate));
    }
  }
  return {
    coordinateScale,
    minimumElementEdgeLength: measuredMinimumEdge ?? (
      mesh.elements.length === 0
        ? Number.POSITIVE_INFINITY
        : minElementEdgeLength(mesh)
    )
  };
}

function findMergedActiveNodeIndex(
  point: Point,
  nodes: readonly Point[],
  buckets: ReadonlyMap<string, readonly number[]>,
  layout: MergeBucketLayout,
  tolerance: number
): number | undefined {
  let bestIndex: number | undefined;
  forEachCandidateMergeBucketKey(point, layout, (key) => {
    for (const candidateIndex of buckets.get(key) ?? []) {
      if (bestIndex !== undefined && candidateIndex >= bestIndex) {
        continue;
      }
      const candidate = nodes[candidateIndex]!;
      if (candidate.length !== point.length) {
        continue;
      }
      if (Math.hypot(
        ...point.map((coordinate, dimension) =>
          (candidate[dimension] ?? 0) - coordinate
        )
      ) <= tolerance) {
        bestIndex = candidateIndex;
      }
    }
  });
  return bestIndex;
}

function addActiveMergeBucket(
  point: Point,
  nodeIndex: number,
  buckets: Map<string, number[]>,
  layout: MergeBucketLayout,
  tolerance: number
): void {
  const key = mergeBucketKey(point, layout);
  const bucket = buckets.get(key) ?? [];
  bucket.push(nodeIndex);
  buckets.set(key, bucket);
}

function exactActiveMergeKey(point: Point): string {
  const coordinates = point.map((coordinate) =>
    Object.is(coordinate, -0) ? 0 : coordinate
  );
  return `${point.length}|${coordinates.join(":")}`;
}

function exactReaderActiveMergeKey(point: Point): string {
  const coordinateCount = planningArrayLength(point, "active merge point");
  let key = `${coordinateCount}|`;
  for (let index = 0; index < coordinateCount; index += 1) {
    const coordinate = planningArrayValue<number>(
      point,
      index,
      "active merge point"
    );
    if (index > 0) key += ":";
    key += String(Object.is(coordinate, -0) ? 0 : coordinate);
  }
  return key;
}

export function activeBuildCellIdByElementId(build: ActiveMeshBuildResult, elementId: number): CellId | undefined {
  return ensureTrustedActiveMeshMappings(build).cellIdsByElementIdArray[elementId];
}

export function activeBuildSessionNodeIdsByNodeId(
  build: ActiveMeshBuildResult,
  nodeId: number
): readonly number[] {
  return ensureTrustedActiveMeshMappings(build).sessionNodeIdsByNodeId.get(nodeId) ?? [];
}

export function activeBuildHasSessionNodeIds(
  build: ActiveMeshBuildResult
): boolean {
  return ensureTrustedActiveMeshMappings(build).sessionNodeIdsByNodeId.size > 0;
}

export function activeBuildElementIdByCellId(
  session: RefinementSession,
  build: ActiveMeshBuildResult,
  cellId: CellId
): number | undefined {
  const validated = validateActiveBuildSession(session, build, [cellId]);
  return validateActiveBuildCellForSession(
    session,
    validated,
    cellId,
    [cellId],
    true
  );
}

function trustedOptionalElementIdByCellId(
  session: RefinementSession,
  mappings: TrustedActiveMeshMappings,
  cellId: CellId
): number | undefined {
  const ordinal = session.cells.get(cellId)?.ordinal;
  if (!isValidCellOrdinal(ordinal)) {
    return undefined;
  }
  const ordinalArray = mappings.elementIdByCellOrdinalArray;
  const cellIdsByElementId = mappings.cellIdsByElementIdArray;
  if (ordinalArray === undefined || ordinal >= ordinalArray.length) {
    throw sessionFaceResolutionError(
      [cellId],
      `external activeBuild is stale because mapping is missing ordinal slot ${ordinal} for cell ${cellId}`
    );
  }
  const elementId = ordinalArray[ordinal];
  if (elementId === undefined) {
    throw sessionFaceResolutionError(
      [cellId],
      `external activeBuild is stale because mapping is missing ordinal slot ${ordinal} for cell ${cellId}`
    );
  }
  if (elementId === 0) {
    if (mappings.elementIdByCellId.has(cellId)) {
      throw sessionFaceResolutionError(
        [cellId],
        `external activeBuild is stale because mapping disagrees about inactive cell ${cellId}`
      );
    }
    return undefined;
  }
  if (
    !Number.isSafeInteger(elementId)
    || elementId <= 0
    || cellIdsByElementId[elementId] !== cellId
  ) {
    throw sessionFaceResolutionError(
      [cellId],
      `external activeBuild is stale because mapping disagrees with ordinal ${ordinal} for cell ${cellId}`
    );
  }
  const reverseElementId = mappings.elementIdByCellId.get(cellId);
  const reverseCellId = mappings.cellIdByElementId.get(elementId);
  if (reverseElementId !== elementId || reverseCellId !== cellId) {
    throw sessionFaceResolutionError(
      [cellId],
      `external activeBuild is stale because reverse mapping disagrees for cell ${cellId}`
    );
  }
  return elementId;
}

function isValidCellOrdinal(ordinal: number | undefined): ordinal is number {
  return ordinal !== undefined
    && Number.isSafeInteger(ordinal)
    && ordinal > 0;
}

function localCellOrdinalArrayLength(
  state: RefinementSessionStateReader,
  activeIds: readonly CellId[],
  activeIdCount: number
): number {
  let maximumOrdinal = 0;
  for (let index = 0; index < activeIdCount; index += 1) {
    const cellId = planningArrayValue<CellId>(
      activeIds,
      index,
      "reader planning active cell ids"
    );
    const ordinal = requiredSessionStateCell(state, cellId).ordinal;
    if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
      throw new Error(`cell ${cellId} has invalid ordinal ${ordinal}`);
    }
    maximumOrdinal = Math.max(maximumOrdinal, ordinal);
  }
  return maximumOrdinal + 1;
}

function recordActiveElementByCellOrdinal(
  elementIdByCellOrdinalArray: Int32Array,
  cell: RefinementSessionCell,
  elementId: number
): void {
  if (
    !isValidCellOrdinal(cell.ordinal)
    || cell.ordinal >= elementIdByCellOrdinalArray.length
    || elementIdByCellOrdinalArray[cell.ordinal] !== 0
  ) {
    throw new RangeError(`cell ${cell.id} has invalid or duplicate ordinal ${cell.ordinal}`);
  }
  elementIdByCellOrdinalArray[cell.ordinal] = elementId;
}

export function remapSessionSetsToActiveMesh(
  build: ActiveMeshBuildResult,
  sets: RefinementSessionSetRemapInput
): ActiveMeshSetRemapResult {
  const mappings = ensureTrustedActiveMeshMappings(build);
  const elementIdByCellId = mappings.elementIdByCellId;
  const nodeIdBySessionNodeId = mappings.nodeIdBySessionNodeId;
  const cellSets = new Map<string, number[]>();
  const nodeSets = new Map<string, number[]>();
  const missingCellIdsBySet = new Map<string, CellId[]>();
  const missingNodeIdsBySet = new Map<string, number[]>();

  for (const [name, cellIds] of namedSetEntries(sets.cellSets)) {
    const elementIds: number[] = [];
    const missingCellIds: CellId[] = [];
    for (const cellId of uniquePreserveOrder(cellIds)) {
      const elementId = elementIdByCellId.get(cellId);
      if (elementId === undefined) {
        missingCellIds.push(cellId);
      } else {
        elementIds.push(elementId);
      }
    }
    cellSets.set(name, uniqueSortedNumbers(elementIds));
    if (missingCellIds.length > 0) {
      missingCellIdsBySet.set(name, missingCellIds);
    }
  }

  for (const [name, sessionNodeIds] of namedSetEntries(sets.nodeSets)) {
    const nodeIds: number[] = [];
    const missingNodeIds: number[] = [];
    for (const sessionNodeId of uniquePreserveOrder(sessionNodeIds)) {
      const nodeId = nodeIdBySessionNodeId.get(sessionNodeId);
      if (nodeId === undefined) {
        missingNodeIds.push(sessionNodeId);
      } else {
        nodeIds.push(nodeId);
      }
    }
    nodeSets.set(name, uniqueSortedNumbers(nodeIds));
    if (missingNodeIds.length > 0) {
      missingNodeIdsBySet.set(name, missingNodeIds);
    }
  }

  return {
    cellSets,
    nodeSets,
    missingCellIdsBySet,
    missingNodeIdsBySet
  };
}

export function buildRefinementSessionExport(
  session: RefinementSession,
  options: RefinementSessionExportOptions = {}
): RefinementSessionExportResult {
  const buildOptions: BuildActiveMeshOptions = { mergeNodes: options.mergeNodes ?? true };
  if (options.mergeTolerance !== undefined) {
    buildOptions.mergeTolerance = options.mergeTolerance;
  }
  const build = buildActiveMeshWithMap(session, buildOptions);
  return {
    mesh: build.mesh,
    build,
    sets: remapSessionSetsToActiveMesh(build, options.sets ?? {})
  };
}

export function checkRefinementSessionCommandConformance(
  session: RefinementSession,
  command: RefinementSessionCommand,
  tolerance = 1e-9,
  activeBuild?: ActiveMeshBuildResult
): RefinementSessionLocalConformanceReport {
  const active = activeBuild ?? buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: tolerance,
    includeElementIdsByNodeId: true
  });
  const seedCellIds = command.activeCreatedCellIds === undefined
    ? command.createdCellIds.filter((cellId) => {
        const cell = session.cells.get(cellId);
        return cell !== undefined
          && cell.active
          && !cell.hidden
          && session.activeLeafIds.has(cellId);
      })
    : command.activeCreatedCellIds;
  validateActiveBuildCellsForSession(session, active, seedCellIds);
  const seedElementIds = seedCellIds
    .map((cellId) => {
      const elementId = activeBuildElementIdByCellId(session, active, cellId);
      if (elementId === undefined && command.activeCreatedCellIds !== undefined) {
        throw sessionFaceResolutionError(
          seedCellIds,
          `command recorded active cell ${cellId}, but it does not map to an active element`
        );
      }
      return elementId;
    })
    .filter((elementId): elementId is number => elementId !== undefined)
    .sort((a, b) => a - b);
  const local = buildLocalActiveMeshAroundElements(active, seedElementIds);
  const report = local.mesh.elements.length === 0
    ? { ok: true, hanging: [], unmatchedInteriorBoundaryCount: 0 }
    : checkNoHangingNodes(local.mesh, tolerance);
  return {
    report,
    mesh: local.mesh,
    activeBuild: active,
    checkedCellIds: local.checkedCellIds,
    checkedElementIds: local.checkedElementIds,
    seedCellIds: seedElementIds
      .map((elementId) => activeBuildCellIdByElementId(active, elementId))
      .filter((cellId): cellId is CellId => cellId !== undefined),
    seedElementIds
  };
}

export function refineSessionCell(
  session: RefinementSession,
  cellId: CellId,
  factory: LocalRefinementFactory
): RefinementSessionCommand {
  return refineSessionCells(session, [cellId], factory);
}

export function refineSessionCells(
  session: RefinementSession,
  cellIds: CellId[],
  factory: LocalRefinementFactory
): RefinementSessionCommand {
  const mutable = mutableRefinementSession(session);
  const state = createDirectRefinementSessionState(
    session,
    exactActiveMergeKey
  );
  const validation = validateRefinementSessionSelection(session, cellIds);
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }

  const parentIds = validation.cellIds.sort(compareCellIds);
  const meshView = sessionMeshView(session);
  const planned = parentIds.map((parentId) => {
    const parent = requiredCell(session, parentId);
    const vertices = elementVertices(meshView, parent.element);
    const refinement = factory(vertices);
    if (refinement.kind !== parent.kind) {
      throw new Error(`refinement kind ${refinement.kind} does not match parent kind ${parent.kind}`);
    }
    if (parent.kind === "H1") {
      assertHexRefinementQuality(vertices, refinement, `refinement of ${parentId}`);
    }
    return { parentId, parent, refinement };
  });
  const quality = session.kind === "H1" && planned.length > 0
    ? auditHexRefinementPatchQuality(
        {
          kind: "H1",
          nodes: mutable.nodes,
          elements: planned.map(({ parent }) => parent.element)
        },
        planned.map(({ refinement }, index) => ({
          elementId: index + 1,
          refinement
        }))
      )
    : undefined;
  if (quality !== undefined) {
    assertHexPatchQualitySummary(quality, "session refinement patch");
  }
  const createdCellIds: CellId[] = [];
  const createdNodeIds: number[] = [];
  const hiddenCellIds: CellId[] = [];

  for (const { parentId, parent, refinement } of planned) {
    const nodeOffset = mutable.nodes.length;
    for (const [index, point] of refinement.nodes.entries()) {
      mutable.nodes.push([...point]);
      createdNodeIds.push(nodeOffset + index + 1);
    }

    const parentCreatedCellIds: CellId[] = [];
    const firstChildIndex = parent.children.length + 1;
    refinement.elements.forEach((element, index) => {
      const childId = `${parentId}/${firstChildIndex + index}`;
      parentCreatedCellIds.push(childId);
      createdCellIds.push(childId);
      const child: MutableRefinementSessionCell = {
        id: childId,
        ordinal: nextCellOrdinal(session),
        parentId,
        level: parent.level + 1,
        role: "selected",
        kind: parent.kind,
        element: element.map((nodeId) => nodeId + nodeOffset),
        children: [],
        active: true,
        hidden: false,
        template: refinement.source
      };
      if (parent.sourceElementId !== undefined) {
        child.sourceElementId = parent.sourceElementId;
      }
      mutable.cells.set(childId, child);
      state.addActiveLeaf(childId);
    });

    parent.children.push(...parentCreatedCellIds);
    parent.active = false;
    parent.hidden = true;
    state.removeActiveLeaf(parentId);
    hiddenCellIds.push(parentId);
  }

  const command = freezeRefinementSessionCommand({
    id: `cmd-${mutable.nextCommandId}`,
    kind: "refine",
    hiddenCellIds,
    createdCellIds,
    createdNodeIds,
    ...(quality ? { quality } : {})
  });
  mutable.nextCommandId += 1;
  mutable.undoStack.push(command);
  mutable.redoStack = [];
  mutable.revision += 1;
  return command;
}

interface RefinementSessionPatchInternalOptions {
  readonly allowExistingTransitionShellRebuild: boolean;
}

const PUBLIC_REFINEMENT_SESSION_PATCH = Object.freeze({
  allowExistingTransitionShellRebuild: true
});

const TRANSACTION_REFINEMENT_SESSION_PATCH = Object.freeze({
  allowExistingTransitionShellRebuild: false
});

export function refineSessionPatch(
  session: RefinementSession,
  cellIds: CellId[],
  options: RefinementSessionPatchOptions = {}
): RefinementSessionCommand {
  return refineSessionPatchInternal(
    session,
    cellIds,
    options,
    PUBLIC_REFINEMENT_SESSION_PATCH
  );
}

function refineSessionPatchInternal(
  session: RefinementSession,
  cellIds: CellId[],
  options: RefinementSessionPatchOptions,
  internalOptions: RefinementSessionPatchInternalOptions,
  prebuiltPlan?: RefinementSessionPatchPlanInternal
): RefinementSessionCommand {
  if (prebuiltPlan !== undefined) {
    return applyRefinementSessionPatchPlanInternal(
      session,
      prebuiltPlan
    );
  }
  const resolvedOptions = resolveSessionPatchOptions(session, cellIds, options);
  try {
    let plan: RefinementSessionPatchPlanInternal;
    try {
      plan = buildRefinementSessionPatchPlan(session, cellIds, resolvedOptions);
    } catch (error) {
      if (
        internalOptions.allowExistingTransitionShellRebuild
      ) {
        const faceResolution = resolveExistingTransitionShellRebuild(
          session,
          cellIds,
          resolvedOptions,
          error
        );
        if (faceResolution !== undefined) {
          const transaction =
            planRefinementSessionHistoryTransaction(
              session,
              cellIds,
              resolvedOptions,
              faceResolution,
              false
            );
          commitRefinementSessionOverlay(
            session,
            transaction.delta
          );
          publishHistoryConformanceAfterCommit(session, transaction);
          const committedCommand = session.undoStack.at(-1);
          if (
            committedCommand === undefined
            || committedCommand.id !== transaction.command.id
          ) {
            throw new Error(
              "history transaction committed without its aggregate command"
            );
          }
          return committedCommand;
        }
      }
      throw error;
    }
    return applyRefinementSessionPatchPlanInternal(session, plan);
  } catch (error) {
    throw asTwoToOneSessionPlanningError(
      error,
      cellIds,
      resolvedOptions.activeBuild
    );
  }
}

type ResolvedRefinementSessionPatchOptions = RefinementSessionPatchOptions & {
  activeBuild: ActiveMeshBuildResult;
  mergeTolerance: number;
  normalizedTwoToOneCompensation?: Readonly<NormalizedTwoToOneCompensation>;
};

interface SessionPatchOptionSnapshot {
  readonly includeTransitions: boolean;
  readonly hexRefinementRatio: 2 | 3;
  readonly hexTwoToOneSelectionMode: "section" | "local";
  readonly rebuildExistingTransitions: boolean;
  readonly transitionSupportCellIds: readonly CellId[];
  readonly requestedMergeTolerance?: number;
  readonly normalizedTwoToOneCompensation: Readonly<NormalizedTwoToOneCompensation>;
  readonly suppliedHexTwoToOneCompensation?: Readonly<NormalizedTwoToOneCompensation>;
  readonly suppliedActiveBuild?: ActiveMeshBuildResult;
}

interface SessionPatchGeometryResolution {
  readonly activeBuild: ActiveMeshBuildResult;
  readonly mergeTolerance: number;
  readonly faceTolerance: number;
  readonly coordinateScale: number;
  readonly minimumElementEdgeLength: number;
}

function resolveSessionPatchOptions(
  session: RefinementSession,
  diagnosticCellIds: readonly CellId[],
  options: RefinementSessionPatchOptions
): ResolvedRefinementSessionPatchOptions {
  const snapshot = snapshotSessionPatchOptions(
    session,
    diagnosticCellIds,
    options
  );
  const geometry = resolveSessionPatchGeometry(
    session,
    diagnosticCellIds,
    snapshot
  );
  return {
    includeTransitions: snapshot.includeTransitions,
    hexRefinementRatio: snapshot.hexRefinementRatio,
    hexTwoToOneSelectionMode: snapshot.hexTwoToOneSelectionMode,
    rebuildExistingTransitions: snapshot.rebuildExistingTransitions,
    transitionSupportCellIds: snapshot.transitionSupportCellIds,
    ...(snapshot.suppliedHexTwoToOneCompensation === undefined
      ? {}
      : {
          hexTwoToOneCompensation:
            snapshot.suppliedHexTwoToOneCompensation
        }),
    activeBuild: geometry.activeBuild,
    mergeTolerance: geometry.mergeTolerance,
    normalizedTwoToOneCompensation:
      snapshot.normalizedTwoToOneCompensation
  };
}

function snapshotSessionPatchOptions(
  session: RefinementSession,
  diagnosticCellIds: readonly CellId[],
  options: RefinementSessionPatchOptions
): SessionPatchOptionSnapshot {
  const recipeCompensationCarrier =
    snapshotRecipeCompensationCarrier(options);
  const optionDescriptors = Object.getOwnPropertyDescriptors(options);
  const compensationDescriptor = optionDescriptors.hexTwoToOneCompensation;
  delete optionDescriptors.hexTwoToOneCompensation;
  const optionsSnapshot: RefinementSessionPatchOptions = {
    ...Object.defineProperties({}, optionDescriptors)
  };
  assertValidSessionFaceTolerance(optionsSnapshot.mergeTolerance);
  const includeTransitions = optionsSnapshot.includeTransitions ?? true;
  const hexRefinementRatio = optionsSnapshot.hexRefinementRatio ?? 3;
  const hexTwoToOneSelectionMode =
    optionsSnapshot.hexTwoToOneSelectionMode ?? "section";
  const supportsLocalTwoToOneTransitions =
    session.kind === "H1"
    && hexRefinementRatio === 2
    && hexTwoToOneSelectionMode === "local"
    && includeTransitions;
  let normalizedTwoToOneCompensation:
    Readonly<NormalizedTwoToOneCompensation>;
  let suppliedHexTwoToOneCompensation:
    Readonly<NormalizedTwoToOneCompensation> | undefined;
  if (supportsLocalTwoToOneTransitions) {
    if (compensationDescriptor !== undefined) {
      Object.defineProperty(
        optionsSnapshot,
        "hexTwoToOneCompensation",
        {
          configurable: true,
          enumerable: true,
          writable: true,
          value: options.hexTwoToOneCompensation
        }
      );
    }
    normalizedTwoToOneCompensation = Object.freeze(
      normalizeTwoToOneCompensation(
        new Set(diagnosticCellIds).size,
        optionsSnapshot
      )
    );
    if (compensationDescriptor !== undefined) {
      suppliedHexTwoToOneCompensation =
        normalizedTwoToOneCompensation;
    }
  } else {
    normalizedTwoToOneCompensation = Object.freeze(
      normalizeTwoToOneCompensation(
        new Set(diagnosticCellIds).size,
        recipeCompensationCarrier
      )
    );
  }
  return Object.freeze({
    includeTransitions,
    hexRefinementRatio,
    hexTwoToOneSelectionMode,
    rebuildExistingTransitions:
      normalizedTwoToOneCompensation.mode !== "none",
    transitionSupportCellIds: Object.freeze(
      stableCellIds(optionsSnapshot.transitionSupportCellIds ?? [])
    ),
    ...(optionsSnapshot.mergeTolerance === undefined
      ? {}
      : { requestedMergeTolerance: optionsSnapshot.mergeTolerance }),
    normalizedTwoToOneCompensation,
    ...(suppliedHexTwoToOneCompensation === undefined
      ? {}
      : { suppliedHexTwoToOneCompensation }),
    ...(optionsSnapshot.activeBuild === undefined
      ? {}
      : { suppliedActiveBuild: optionsSnapshot.activeBuild })
  });
}

function resolveSessionPatchGeometry(
  session: RefinementSession,
  diagnosticCellIds: readonly CellId[],
  snapshot: SessionPatchOptionSnapshot
): SessionPatchGeometryResolution {
  let activeBuild = snapshot.suppliedActiveBuild;
  let certifiedResolution:
    | Pick<
        SessionPatchGeometryResolution,
        "coordinateScale" | "minimumElementEdgeLength"
      >
    | undefined;
  if (activeBuild !== undefined) {
    if (
      activeBuild.mergeTolerance !== undefined
      && (
        !Number.isFinite(activeBuild.mergeTolerance)
        || activeBuild.mergeTolerance < 0
      )
    ) {
      throw sessionFaceResolutionError(
        diagnosticCellIds,
        "external activeBuild records an invalid merge tolerance"
      );
    }
    assertActiveBuildCoversSessionCells(
      session,
      activeBuild,
      diagnosticCellIds
    );
    const recordedTolerance = activeBuild.mergeTolerance;
    if (
      snapshot.requestedMergeTolerance !== undefined
      && (
        recordedTolerance === undefined
        || snapshot.requestedMergeTolerance !== recordedTolerance
      )
    ) {
      throw sessionFaceResolutionError(
        diagnosticCellIds,
        recordedTolerance === undefined
          ? "external activeBuild does not record a merge tolerance, so requested planning consistency cannot be proven"
          : `external activeBuild merge tolerance ${recordedTolerance} does not match requested merge tolerance ${snapshot.requestedMergeTolerance}`
      );
    }
  } else {
    const certificate =
      currentRefinementSessionConformanceCertificate(session);
    if (certificate !== undefined) {
      const certificateMergeTolerance =
        snapshot.requestedMergeTolerance
        ?? effectiveSessionFaceTolerance(
          certificate.minimumElementEdgeLength,
          certificate.coordinateScale
        );
      const certificateFaceTolerance = effectiveSessionFaceTolerance(
        certificate.minimumElementEdgeLength,
        certificate.coordinateScale,
        certificateMergeTolerance
      );
      if (certificateFaceTolerance === certificate.tolerance) {
        certifiedResolution = certificate;
      }
    }
    const activeCellIds = sortedActiveLeafIdsSnapshot(session);
    const certificateMergeTolerance = certifiedResolution === undefined
      ? undefined
      : snapshot.requestedMergeTolerance
        ?? effectiveSessionFaceTolerance(
          certifiedResolution.minimumElementEdgeLength,
          certifiedResolution.coordinateScale
        );
    const buildOptions: BuildActiveMeshOptions = {
      mergeNodes: true,
      includeSessionNodeIdByNodeId: false,
      includeSessionNodeIdsByNodeId: false,
      ...(certificateMergeTolerance !== undefined
        ? { mergeTolerance: certificateMergeTolerance }
        : snapshot.requestedMergeTolerance === undefined
          ? {}
          : { mergeTolerance: snapshot.requestedMergeTolerance })
    };
    try {
      activeBuild = buildActiveMeshForCellIdsWithMap(
        session,
        activeCellIds,
        buildOptions,
        (resolution) => effectiveSessionFaceTolerance(
          resolution.minimumElementEdgeLength,
          resolution.coordinateScale
        ),
        false
      );
    } catch (error) {
      if (
        error instanceof Error
        && /non-finite coordinate|ordinal/i.test(error.message)
      ) {
        throw sessionFaceResolutionError(diagnosticCellIds, error.message);
      }
      throw error;
    }
  }
  const geometryResolution = certifiedResolution
    ?? activeBuild.geometryResolution;
  if (geometryResolution === undefined) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      "activeBuild does not expose immutable geometry resolution metadata"
    );
  }
  const mergeTolerance = activeBuild.mergeTolerance
    ?? effectiveSessionFaceTolerance(
      geometryResolution.minimumElementEdgeLength,
      geometryResolution.coordinateScale
    );
  const faceTolerance = effectiveSessionFaceTolerance(
    geometryResolution.minimumElementEdgeLength,
    geometryResolution.coordinateScale,
    mergeTolerance
  );
  assertSessionFaceGeometryResolution(
    diagnosticCellIds,
    faceTolerance,
    geometryResolution.minimumElementEdgeLength,
    session.activeLeafIds.size > 0
  );
  return {
    activeBuild,
    mergeTolerance,
    faceTolerance,
    coordinateScale: geometryResolution.coordinateScale,
    minimumElementEdgeLength:
      geometryResolution.minimumElementEdgeLength
  };
}

function resolveSessionStatePatchOptions(
  state: RefinementSessionStateReader,
  diagnosticCellIds: readonly CellId[],
  options: RefinementSessionPatchOptions,
  scope?: HistoryPlanningScope
): ResolvedRefinementSessionPatchOptions {
  const recipeCompensationCarrier =
    snapshotRecipeCompensationCarrier(options);
  const optionDescriptors = Object.getOwnPropertyDescriptors(options);
  const compensationDescriptor = optionDescriptors.hexTwoToOneCompensation;
  if (optionDescriptors.activeBuild !== undefined) {
    throw new TypeError(
      "reader patch planning does not accept options.activeBuild"
    );
  }
  delete optionDescriptors.hexTwoToOneCompensation;
  const optionsSnapshot: RefinementSessionPatchOptions = {
    ...Object.defineProperties({}, optionDescriptors)
  };
  assertValidSessionFaceTolerance(optionsSnapshot.mergeTolerance);
  const activeCellIds = scope?.activeCellIds ?? sortedActiveLeafIdsFromSessionState(state);
  const buildOptions: BuildActiveMeshOptions = {
    mergeNodes: true,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false,
    ...(optionsSnapshot.mergeTolerance === undefined
      ? {}
      : { mergeTolerance: optionsSnapshot.mergeTolerance })
  };
  let activeBuild: ActiveMeshBuildResult;
  try {
    activeBuild = scope === undefined ? buildActiveMeshForSessionStateCellIdsWithMap(
      state,
      activeCellIds,
      buildOptions,
      (resolution) => effectiveSessionFaceTolerance(
        resolution.minimumElementEdgeLength,
        resolution.coordinateScale
      ),
      (result, mergeTolerance, measuredResolution) =>
        finalizeActiveMeshBuildFromSessionState(
          result,
          mergeTolerance,
          measuredResolution
        )
    ) : historyPlanningBuilds(state, scope).buildComplete({
      ...buildOptions,
      mergeTolerance: optionsSnapshot.mergeTolerance ?? effectiveSessionFaceTolerance(
        scope.geometryResolution.minimumElementEdgeLength,
        scope.geometryResolution.coordinateScale
      )
    });
  } catch (error) {
    if (
      error instanceof Error
      && /non-finite coordinate|ordinal/i.test(error.message)
    ) {
      throw sessionFaceResolutionError(diagnosticCellIds, error.message);
    }
    throw error;
  }
  const geometryResolution = activeBuild.geometryResolution;
  if (geometryResolution === undefined) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      "activeBuild does not expose immutable geometry resolution metadata"
    );
  }
  const mergeTolerance = activeBuild.mergeTolerance
    ?? effectiveSessionFaceTolerance(
      geometryResolution.minimumElementEdgeLength,
      geometryResolution.coordinateScale
    );
  const faceTolerance = effectiveSessionFaceTolerance(
    geometryResolution.minimumElementEdgeLength,
    geometryResolution.coordinateScale,
    mergeTolerance
  );
  assertSessionFaceGeometryResolution(
    diagnosticCellIds,
    faceTolerance,
    geometryResolution.minimumElementEdgeLength,
    state.activeLeafCount > 0
  );
  const supportsLocalTwoToOneTransitions =
    state.kind === "H1"
    && optionsSnapshot.hexRefinementRatio === 2
    && optionsSnapshot.hexTwoToOneSelectionMode === "local"
    && (optionsSnapshot.includeTransitions ?? true);
  let normalizedTwoToOneCompensation:
    | Readonly<NormalizedTwoToOneCompensation>
    | undefined;
  if (supportsLocalTwoToOneTransitions) {
    if (compensationDescriptor !== undefined) {
      Object.defineProperty(
        optionsSnapshot,
        "hexTwoToOneCompensation",
        {
          configurable: true,
          enumerable: true,
          writable: true,
          value: options.hexTwoToOneCompensation
        }
      );
    }
    normalizedTwoToOneCompensation = Object.freeze(
      normalizeTwoToOneCompensation(
        new Set(diagnosticCellIds).size,
        optionsSnapshot
      )
    );
    optionsSnapshot.hexTwoToOneCompensation =
      normalizedTwoToOneCompensation;
  } else {
    normalizedTwoToOneCompensation = Object.freeze(
      normalizeTwoToOneCompensation(
        new Set(diagnosticCellIds).size,
        recipeCompensationCarrier
      )
    );
  }
  return {
    ...optionsSnapshot,
    activeBuild,
    mergeTolerance,
    ...(normalizedTwoToOneCompensation === undefined
      ? {}
      : { normalizedTwoToOneCompensation })
  };
}

/** @internal Applies a prebuilt plan to a concrete session transaction. */
export function applyRefinementSessionPatchPlanInternal(
  session: RefinementSession,
  plan: RefinementSessionPatchPlanInternal
): RefinementSessionCommand {
  assertTrustedRefinementSessionPatchPlan(plan);
  assertRefinementSessionPatchPlanParents(session, plan);
  const mutable = mutableRefinementSession(session);
  const state = createDirectRefinementSessionState(
    session,
    exactActiveMergeKey
  );
  const command = applyRefinementSessionPatchPlanToStateInternal(state, plan);
  mutable.revision += 1;
  return command;
}

/** @internal Applies a prebuilt plan without advancing state revision. */
export function applyRefinementSessionPatchPlanToStateInternal(
  state: RefinementSessionStateWriter,
  plan: RefinementSessionPatchPlanInternal
): RefinementSessionCommand {
  assertTrustedRefinementSessionPatchPlan(plan);
  const prepared = prepareRefinementSessionPatchApplication(state, plan);
  const activeLeafBatch = state.prepareActiveLeafBatch({
    additions: prepared.replacements.flatMap(
      (replacement) => replacement.children
    ),
    removals: prepared.hiddenCellIds,
    appendedNodes: prepared.replacements.flatMap(
      (replacement) => replacement.nodes
    )
  });
  recordRefinementSessionPatchApplicationReferences(state, prepared);

  for (const replacement of prepared.replacements) {
    const parent = state.mutableCell(replacement.parentId);
    for (const point of replacement.nodes) {
      state.appendNode(point);
    }
    for (const child of replacement.children) {
      state.allocateCellOrdinal();
      state.setCell(mutablePreparedRefinementSessionCell(child));
    }
    parent.children.push(...replacement.childIds);
  }

  for (const parentId of prepared.hiddenCellIds) {
    const parent = requiredStateMutableCell(state, parentId);
    parent.active = false;
    parent.hidden = true;
  }

  state.commitActiveLeafBatch(activeLeafBatch);
  state.setNextCommandId(prepared.nextCommandId);
  state.appendUndoCommand(prepared.command);
  state.clearRedoCommands();
  return prepared.command;
}

function refineSessionPatchOnStateInternal(
  state: RefinementSessionStateWriter,
  cellIds: CellId[],
  options: RefinementSessionPatchOptions,
  prebuiltPlan?: RefinementSessionPatchPlanInternal
): RefinementSessionCommand {
  const plan = prebuiltPlan
    ?? buildRefinementSessionPatchPlanFromStateInternal(
      state,
      cellIds,
      options
    );
  return applyRefinementSessionPatchPlanToStateInternal(state, plan);
}

interface PreparedRefinementSessionPatchReplacement {
  readonly parentId: CellId;
  readonly nodes: readonly Point[];
  readonly childIds: readonly CellId[];
  readonly children: readonly RefinementSessionCell[];
}

interface PreparedRefinementSessionPatchApplication {
  readonly replacements: readonly PreparedRefinementSessionPatchReplacement[];
  readonly hiddenCellIds: readonly CellId[];
  readonly referencedCellIds: readonly CellId[];
  readonly referencedNodeIds: readonly number[];
  readonly nextCommandId: number;
  readonly command: RefinementSessionCommand;
}

function invalidRefinementSessionPatchPlan(message: string): never {
  throw new TypeError(`invalid refinement patch plan: ${message}`);
}

function freezeRefinementSessionPatchReplacement(
  replacement: ClassifiedReplacement
): ClassifiedReplacement {
  const nodes = replacement.refinement.nodes.map((point) =>
    Object.freeze([...point]) as Point
  );
  const elements = replacement.refinement.elements.map((element) =>
    Object.freeze([...element]) as Element
  );
  Object.freeze(nodes);
  Object.freeze(elements);
  return Object.freeze({
    elementId: replacement.elementId,
    role: replacement.role,
    templateCode: replacement.templateCode,
    refinement: Object.freeze({
      kind: replacement.refinement.kind,
      source: replacement.refinement.source,
      nodes,
      elements
    })
  }) as ClassifiedReplacement;
}

function finalizeRefinementSessionPatchPlan(
  plan: RefinementSessionPatchPlanInternal
): RefinementSessionPatchPlanInternal {
  const replacements = plan.replacements.map(
    freezeRefinementSessionPatchReplacement
  );
  const sourceReplacements = plan.sourceReplacements.map(
    freezeRefinementSessionPatchReplacement
  );
  const hiddenCellIds = [...plan.hiddenCellIds];
  Object.freeze(replacements);
  Object.freeze(sourceReplacements);
  Object.freeze(hiddenCellIds);
  const trusted = Object.freeze({
    sourceActive: plan.sourceActive,
    planningActive: plan.planningActive,
    replacements,
    sourceReplacements,
    hiddenCellIds,
    ...(plan.quality === undefined
      ? {}
      : { quality: Object.freeze({ ...plan.quality }) }),
    ...(plan.twoToOne === undefined
      ? {}
      : {
          twoToOne:
            freezeRefinementSessionCapabilityReport(plan.twoToOne)
        }),
    recipe: freezeRefinementSessionCommandRecipe(plan.recipe)
  }) as RefinementSessionPatchPlanInternal;
  TRUSTED_REFLECT_APPLY(
    TRUSTED_WEAK_SET_ADD,
    trustedRefinementSessionPatchPlans,
    [trusted]
  );
  return trusted;
}

function assertTrustedRefinementSessionPatchPlan(
  plan: RefinementSessionPatchPlanInternal
): void {
  if (!TRUSTED_REFLECT_APPLY(
    TRUSTED_WEAK_SET_HAS,
    trustedRefinementSessionPatchPlans,
    [plan]
  )) {
    invalidRefinementSessionPatchPlan(
      "plan is not an authentic trusted builder result"
    );
  }
}

function assertRefinementSessionPatchApplicationCounters(
  state: RefinementSessionStateReader,
  createdCellCount: number,
  appendedNodeCount: number
): { commandId: string; nextCommandId: number } {
  if (
    !Number.isSafeInteger(state.revision)
    || state.revision < 0
    || state.revision >= Number.MAX_SAFE_INTEGER
  ) {
    invalidRefinementSessionPatchPlan("state revision cannot be incremented safely");
  }
  if (
    !Number.isSafeInteger(state.nextCommandId)
    || state.nextCommandId <= 0
    || state.nextCommandId >= Number.MAX_SAFE_INTEGER
  ) {
    invalidRefinementSessionPatchPlan("next command id cannot be incremented safely");
  }
  if (!Number.isSafeInteger(state.cellCount) || state.cellCount < 0) {
    invalidRefinementSessionPatchPlan("state cell count is invalid");
  }
  const expectedNextCellOrdinal = state.cellCount + 1;
  if (
    !Number.isSafeInteger(state.nextCellOrdinal)
    || state.nextCellOrdinal <= 0
    || state.nextCellOrdinal >= Number.MAX_SAFE_INTEGER
    || state.nextCellOrdinal !== expectedNextCellOrdinal
  ) {
    invalidRefinementSessionPatchPlan(
      "next cell ordinal is stale or outside the safe counter range"
    );
  }
  if (!Number.isSafeInteger(state.nextCellOrdinal + createdCellCount)) {
    invalidRefinementSessionPatchPlan("insufficient safe cell ordinal range");
  }
  if (
    !Number.isSafeInteger(state.nodeCount)
    || state.nodeCount < 0
    || !Number.isSafeInteger(state.nodeCount + appendedNodeCount)
  ) {
    invalidRefinementSessionPatchPlan("insufficient safe node id range");
  }
  const commandId = `cmd-${state.nextCommandId}`;
  const existingCommandIds = new Set<string>();
  for (const commands of [state.undoCommands(), state.redoCommands()]) {
    for (const command of commands) {
      if (typeof command?.id !== "string" || command.id.length === 0) {
        invalidRefinementSessionPatchPlan("history contains an invalid command id");
      }
      if (existingCommandIds.has(command.id)) {
        invalidRefinementSessionPatchPlan(`history contains duplicate command id ${command.id}`);
      }
      existingCommandIds.add(command.id);
    }
  }
  if (existingCommandIds.has(commandId)) {
    invalidRefinementSessionPatchPlan(`next command id ${commandId} is already in history`);
  }
  return { commandId, nextCommandId: state.nextCommandId + 1 };
}

function prepareRefinementSessionPatchApplication(
  state: RefinementSessionStateWriter,
  plan: RefinementSessionPatchPlanInternal
): PreparedRefinementSessionPatchApplication {
  const createdCellCount = plan.replacements.reduce(
    (count, replacement) => count + replacement.refinement.elements.length,
    0
  );
  const appendedNodeCount = plan.replacements.reduce(
    (count, replacement) => count + replacement.refinement.nodes.length,
    0
  );
  if (!Number.isSafeInteger(createdCellCount) || !Number.isSafeInteger(appendedNodeCount)) {
    invalidRefinementSessionPatchPlan("replacement output counts exceed the safe range");
  }
  const counters = assertRefinementSessionPatchApplicationCounters(
    state,
    createdCellCount,
    appendedNodeCount
  );
  const parentIds = assertRefinementSessionStatePatchPlanParents(state, plan);
  const replacements: PreparedRefinementSessionPatchReplacement[] = [];
  const createdCellIds: CellId[] = [];
  const referencedCellIds = new Set<CellId>();
  const referencedNodeIds = new Set<number>();
  let nodeOffset = state.nodeCount;
  let ordinal = state.nextCellOrdinal;
  for (let replacementIndex = 0; replacementIndex < plan.replacements.length; replacementIndex += 1) {
    const replacement = plan.replacements[replacementIndex]!;
    const parentId = parentIds[replacementIndex]!;
    const parent = state.peekCell(parentId);
    if (parent === undefined) {
      invalidRefinementSessionPatchPlan(`replacement parent ${parentId} is missing`);
    }
    if (
      replacement.refinement.kind !== parent.kind
      || !Number.isSafeInteger(parent.level)
      || parent.level < 0
      || parent.level >= Number.MAX_SAFE_INTEGER
    ) {
      invalidRefinementSessionPatchPlan(`replacement parent ${parentId} has invalid metadata`);
    }
    referencedCellIds.add(parentId);
    for (const nodeId of parent.element) referencedNodeIds.add(nodeId);
    const firstChildIndex = parent.children.length + 1;
    const childIds: CellId[] = [];
    const children: RefinementSessionCell[] = [];
    for (let elementIndex = 0; elementIndex < replacement.refinement.elements.length; elementIndex += 1) {
      const childId = `${parentId}/${firstChildIndex + elementIndex}`;
      const localElement = replacement.refinement.elements[elementIndex]!;
      const element = localElement.map((nodeId) => nodeId + nodeOffset);
      const child = {
        id: childId,
        ordinal,
        parentId,
        level: parent.level + 1,
        role: replacement.role,
        kind: parent.kind,
        element: Object.freeze(element),
        children: Object.freeze([]) as readonly CellId[],
        active: true,
        hidden: false,
        ...(parent.sourceElementId === undefined
          ? {}
          : { sourceElementId: parent.sourceElementId }),
        template: String(replacement.templateCode)
      } satisfies RefinementSessionCell;
      childIds.push(childId);
      createdCellIds.push(childId);
      children.push(Object.freeze(child));
      ordinal += 1;
    }
    replacements.push(Object.freeze({
      parentId,
      nodes: replacement.refinement.nodes,
      childIds: Object.freeze(childIds),
      children: Object.freeze(children)
    }));
    nodeOffset += replacement.refinement.nodes.length;
  }
  const createdNodeIds = Array.from(
    { length: appendedNodeCount },
    (_, index) => state.nodeCount + index + 1
  );
  const command = freezeRefinementSessionCommand({
    id: counters.commandId,
    kind: "refine",
    hiddenCellIds: plan.hiddenCellIds,
    createdCellIds,
    createdNodeIds,
    ...(plan.quality === undefined ? {} : { quality: plan.quality }),
    ...(plan.twoToOne === undefined ? {} : { twoToOne: plan.twoToOne }),
    recipe: plan.recipe
  });
  return Object.freeze({
    replacements: Object.freeze(replacements),
    hiddenCellIds: Object.freeze([...plan.hiddenCellIds]),
    referencedCellIds: Object.freeze([...referencedCellIds]),
    referencedNodeIds: Object.freeze([...referencedNodeIds]),
    nextCommandId: counters.nextCommandId,
    command
  });
}

function recordRefinementSessionPatchApplicationReferences(
  state: RefinementSessionStateReader,
  prepared: PreparedRefinementSessionPatchApplication
): void {
  for (const cellId of prepared.referencedCellIds) state.cell(cellId);
  for (const nodeId of prepared.referencedNodeIds) state.node(nodeId);
}

function mutablePreparedRefinementSessionCell(
  cell: RefinementSessionCell
): MutableRefinementSessionCell {
  return {
    id: cell.id,
    ordinal: cell.ordinal,
    ...(cell.parentId === undefined ? {} : { parentId: cell.parentId }),
    level: cell.level,
    role: cell.role,
    kind: cell.kind,
    element: [...cell.element],
    children: [...cell.children],
    active: cell.active,
    hidden: cell.hidden,
    ...(cell.sourceElementId === undefined
      ? {}
      : { sourceElementId: cell.sourceElementId }),
    ...(cell.template === undefined ? {} : { template: cell.template })
  };
}

const EXISTING_TRANSITION_COLLISION_ERROR =
  "second-level local 2:1 refinement would create a nonconforming interface with an existing transition layer";

class ExistingTransitionCollisionError extends Error {
  readonly code = "EXISTING_TRANSITION_COLLISION";
}

export interface SessionFaceResolution {
  readonly tolerance: number;
  readonly minimumElementEdgeLength: number;
  readonly coordinateScale: number;
  readonly mergeTolerance?: number;
}

export interface RefinementSessionHistoryTransactionPlan {
  readonly historyClosure: RefinementHistoryClosure;
  readonly context: TransitionRebuildContext;
  readonly localBuild: ActiveMeshBuildResult;
  readonly command: RefinementSessionCommand;
  readonly delta: RefinementSessionOverlayDelta;
  readonly overlayStats: Readonly<RefinementSessionOverlayStats>;
  readonly preview: RefinementPreview<CellId>;
  readonly conformanceAudit: {
    readonly mode: "incremental" | "full-repair";
    readonly checkedElementCount: number;
    readonly requiredInterfaceCount: number;
  };
}

interface HistoryConformanceProof {
  readonly baseline: IndexedConformanceCertificate | undefined;
  readonly mode: "incremental" | "full-repair";
  readonly nextIndex: ConformanceSpatialIndex;
  readonly metadata: RefinementSessionConformanceMetadata;
  readonly checkedElementCount: number;
  readonly requiredInterfaceCount: number;
}

const historyConformanceProofs = new WeakMap<RefinementSessionHistoryTransactionPlan, HistoryConformanceProof>();

function publishHistoryConformanceAfterCommit(
  session: RefinementSession,
  transaction: RefinementSessionHistoryTransactionPlan
): void {
  const proof = historyConformanceProofs.get(transaction);
  if (proof === undefined) throw new Error("history transaction has no conformance proof");
  publishIndexedConformanceCertificate(session, Object.freeze({
    certificate: certifyRefinementSessionBaseline(session, proof.metadata),
    index: proof.nextIndex
  }));
}

function finishHistoryConformancePlan(
  session: RefinementSession,
  plan: RefinementSessionHistoryTransactionPlan,
  proof: HistoryConformanceProof,
  publishBaseline: boolean
): RefinementSessionHistoryTransactionPlan {
  if (publishBaseline && proof.baseline !== undefined) publishIndexedConformanceCertificate(session, proof.baseline);
  historyConformanceProofs.set(plan, proof);
  return plan;
}

function conformanceSpatialCell(state: RefinementSessionStateReader, id: CellId): ConformanceSpatialCell {
  const cell = requiredSessionStateCell(state, id);
  return {
    id, ordinal: cell.ordinal,
    points: cell.element.map((nodeId) => activeSessionStateNode(state, nodeId, id))
  };
}

function auditHistoryConformance(
  session: RefinementSession,
  working: RefinementSessionOverlay,
  removedIds: readonly CellId[],
  addedIds: readonly CellId[],
  resolution: SessionFaceResolution,
  selectedIds: readonly CellId[],
  action: TwoToOneCompensationAction<CellId>
): HistoryConformanceProof {
  const direct = createDirectRefinementSessionState(session, exactActiveMergeKey);
  const options: BuildActiveMeshOptions = {
    mergeNodes: true,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false,
    mergeTolerance: resolution.mergeTolerance ?? resolution.tolerance
  };
  const failure = (message: string) => freezeTwoToOnePlanningErrorDiagnostic(new TwoToOnePlanningError<CellId>(
    "TWO_TO_ONE_CONFORMANCE", `history transaction final mesh is nonconforming: ${message}`,
    {
      conflictingCellIds: stableCellIds(selectedIds), conflictingInterfaces: [],
      attemptedActions: [action], suggestion: { kind: "expand-selection" }
    }
  ));
  let baseline: IndexedConformanceCertificate;
  try {
    baseline = prepareIndexedConformanceBaseline(session, resolution,
      function* () {
        for (const id of session.activeLeafIds) yield conformanceSpatialCell(direct, id);
      },
      () => checkNoHangingNodes(
        buildActiveMeshWithMapFromSessionStateInternal(direct, options).mesh,
        resolution.tolerance
      )
    );
  } catch (error) {
    if (!(error instanceof BaselineConformanceError)) throw error;
    // Existing near-coincident interfaces can be repaired by shell rebuilding.
    // An invalid baseline cannot justify skipping the full final audit.
    const auditState = forkRefinementSessionOverlay(working);
    const finalBuild = buildActiveMeshWithMapFromSessionStateInternal(auditState, options);
    const report = checkNoHangingNodes(finalBuild.mesh, resolution.tolerance);
    if (!report.ok) throw failure(report.hanging[0]?.message ?? "invalid repaired mesh");
    const nextIndex = buildConformanceSpatialIndex((function* () {
      for (const id of auditState.activeLeafIds()) yield conformanceSpatialCell(auditState, id);
    })());
    return {
      baseline: undefined, nextIndex, mode: "full-repair",
      metadata: { ...measureActiveMeshGeometryResolution(finalBuild.mesh), tolerance: resolution.tolerance },
      checkedElementCount: finalBuild.mesh.elements.length, requiredInterfaceCount: 0
    };
  }
  let finalMesh: ReadonlyMesh | undefined;
  const result = auditIncrementalConformance(
    baseline.index,
    removedIds.map((id) => conformanceSpatialCell(direct, id)),
    addedIds.map((id) => conformanceSpatialCell(working, id)),
    resolution.tolerance,
    (ids) => ({
      cellIds: ids,
      mesh: buildActiveMeshForStateCellIdsWithMap(direct, ids, options, resolution).mesh
    }),
    (ids) => {
      finalMesh = buildActiveMeshForStateCellIdsWithMap(working, ids, options, resolution).mesh;
      return { cellIds: ids, mesh: finalMesh };
    }
  );
  if (!result.report.ok) throw failure(result.interfaceError ?? result.report.hanging[0]?.message ?? "invalid local interface");
  const measured = measureActiveMeshGeometryResolution(finalMesh!);
  return {
    baseline, nextIndex: result.nextIndex, mode: "incremental",
    metadata: {
      tolerance: resolution.tolerance,
      coordinateScale: Math.max(resolution.coordinateScale, measured.coordinateScale),
      minimumElementEdgeLength: Math.min(resolution.minimumElementEdgeLength, measured.minimumElementEdgeLength)
    },
    checkedElementCount: result.checkedCellIds.length,
    requiredInterfaceCount: result.requiredInterfaceCount
  };
}

function resolveExistingTransitionShellRebuild(
  session: RefinementSession,
  cellIds: readonly CellId[],
  options: ResolvedRefinementSessionPatchOptions,
  error: unknown
): SessionFaceResolution | undefined {
  const compensation = options.normalizedTwoToOneCompensation;
  if (
    compensation?.mode !== "local-topology"
    || options.hexRefinementRatio !== 2
    || options.hexTwoToOneSelectionMode !== "local"
    || !(error instanceof Error)
  ) {
    return undefined;
  }
  const validation = validateRefinementSessionSelection(session, [...cellIds]);
  if (!validation.ok || validation.level === undefined || validation.level < 1) {
    return undefined;
  }
  const mayRebuild = error instanceof ExistingTransitionCollisionError
    || (error instanceof HexPatchQualityError && error.code === "HEX_PATCH_VOLUME")
    || (
      error instanceof TwoToOnePlanningError
      && error.code === "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY"
    );
  if (!mayRebuild) {
    return undefined;
  }
  const faceResolution = resolveSessionFaceResolution(
    session,
    sortedActiveLeafIdsSnapshot(session),
    validation.cellIds,
    options
  );
  if (error instanceof ExistingTransitionCollisionError) {
    return faceResolution;
  }
  return selectionTouchesActiveTransitionCell(
    session,
    validation.cellIds,
    validation.level,
    faceResolution.tolerance
  )
    ? faceResolution
    : undefined;
}

function selectionTouchesActiveTransitionCell(
  session: RefinementSession,
  selectedCellIds: readonly CellId[],
  level: number,
  tolerance: number
): boolean {
  const selectedFaces = createSessionFaceIndex(tolerance);
  for (const cellId of stableCellIds(selectedCellIds)) {
    for (const face of refinementCellFaces(session, requiredCell(session, cellId))) {
      selectedFaces.add(face);
    }
  }
  let touchesTransition = false;
  for (const cellId of stableCellIds(session.activeLeafIds)) {
    const cell = requiredCell(session, cellId);
    if (cell.level !== level || !isTransitionSessionCell(cell)) {
      continue;
    }
    for (const face of refinementCellFaces(session, cell)) {
      if (selectedFaces.uniqueMatch(face) !== undefined) {
        touchesTransition = true;
      }
    }
  }
  return touchesTransition;
}

export function planRefinementSessionHistoryTransaction(
  session: RefinementSession,
  cellIds: readonly CellId[],
  resolvedOptions: ResolvedRefinementSessionPatchOptions,
  faceResolution: SessionFaceResolution,
  publishBaseline = true
): RefinementSessionHistoryTransactionPlan {
  const validation = validateRefinementSessionSelection(
    session,
    [...cellIds]
  );
  if (
    !validation.ok
    || validation.level === undefined
    || validation.level < 1
  ) {
    throw new Error(
      validation.errors.join("; ")
      || "history transaction planning requires a refined selection"
    );
  }
  const currentRecipe = createRefinementSessionCommandRecipe(
    session,
    validation.cellIds,
    resolvedOptions
  );
  const supportDiscovery =
    discoverTransitionHistorySupportComponent(
      session,
      validation.cellIds,
      validation.level,
      faceResolution.tolerance
    );
  const historyIndex = buildSessionHistoryIndex(session);
  if (
    supportDiscovery.supportCommands.length === 1
    && supportDiscovery.component.supportCellIds.every((cellId) => {
      const cell = requiredCell(session, cellId);
      return cell.active
        && !cell.hidden
        && session.activeLeafIds.has(cellId);
    })
  ) {
    return planUntouchedTransitionShellHistoryTransaction(
      session,
      validation.cellIds,
      resolvedOptions,
      faceResolution,
      supportDiscovery,
      historyIndex,
      publishBaseline
    );
  }
  const preliminaryHistoryClosure =
    buildSessionHistoryClosure(
      historyIndex,
      supportDiscovery.component,
      supportDiscovery.component.supportCellIds
    );
  const preliminaryDownstreamCommandIdSet = new Set(
    preliminaryHistoryClosure.downstreamCommandIds
  );
  const untraceableSupportCellIds =
    supportDiscovery.component.supportCellIds.filter((cellId) => {
      const cell = requiredCell(session, cellId);
      const isInactive = !cell.active
        || cell.hidden
        || !session.activeLeafIds.has(cellId);
      return isInactive
        && !cellHasDownstreamHistoryTrace(
          session,
          historyIndex,
          cellId,
          preliminaryDownstreamCommandIdSet
        );
    });
  if (untraceableSupportCellIds.length > 0) {
    throw historyConflict(
      `automatic transition-shell rebuilding requires an untouched supporting layer with traceable history: ${untraceableSupportCellIds.join(", ")}`,
      untraceableSupportCellIds,
      [
        ...supportDiscovery.supportCommands.map(
          (command) => command.id
        ),
        ...preliminaryHistoryClosure.downstreamCommandIds
      ]
    );
  }
  assertEligibleDownstreamHistoryCommands(
    historyIndex,
    preliminaryHistoryClosure
  );
  assertHistorySupportCommands(
    preliminaryHistoryClosure,
    supportDiscovery
  );
  const preliminaryCollisionWorking = createRefinementSessionOverlay(
    session,
    {
      nodeKey: exactActiveMergeKey,
      cellNodeIds: (cell) => cell.element
    }
  );
  const preliminaryDownstreamCommands =
    preliminaryHistoryClosure.downstreamCommandIds.map(
      (commandId) => {
        const command = historyIndex.commandById.get(commandId);
        if (command === undefined) {
          throw new Error(
            `history closure references unknown command ${commandId}`
          );
        }
        return command;
      }
    );
  reverseRefinementHistoryCommands(
    preliminaryCollisionWorking,
    preliminaryDownstreamCommands,
    historyIndex.commandOrdinalById
  );
  const preliminaryCollidingTransitionParentIds =
    findCollidingTransitionParentIdsFromState(
      preliminaryCollisionWorking,
      validation.cellIds,
      supportDiscovery.component.supportCellIds,
      validation.level,
      resolvedOptions,
      faceResolution.tolerance
    );
  const discovered = completeTransitionHistoryComponentFromState(
    preliminaryCollisionWorking,
    supportDiscovery,
    preliminaryCollidingTransitionParentIds
  );
  const historyClosure = buildSessionHistoryClosure(
    historyIndex,
    discovered.component,
    [
      ...discovered.component.supportCellIds,
      ...discovered.component.collidingTransitionParentIds
    ]
  );
  assertEligibleDownstreamHistoryCommands(
    historyIndex,
    historyClosure
  );
  assertHistorySupportCommands(
    historyClosure,
    discovered
  );
  const context = buildTransitionRebuildContext(
    session,
    validation.cellIds,
    discovered.component,
    historyClosure,
    faceResolution
  );

  const working = createRefinementSessionOverlay(
    session,
    {
      nodeKey: exactActiveMergeKey,
      cellNodeIds: (cell) => cell.element
    }
  );
  const historyCheckpoint =
    checkpointRefinementSessionOverlayHistory(working);
  const originalNodeCount = session.nodes.length;
  const compoundCommandId = `cmd-${session.nextCommandId}`;
  const closureCommandIds = [
    ...historyClosure.supportCommandIds,
    ...historyClosure.downstreamCommandIds
  ];
  const closureCommands = closureCommandIds.map((commandId) => {
    const command = historyIndex.commandById.get(commandId);
    if (command === undefined) {
      throw new Error(
        `history closure references unknown command ${commandId}`
      );
    }
    return command;
  });
  const downstreamCommandIdSet = new Set(
    historyClosure.downstreamCommandIds
  );
  reverseRefinementHistoryCommands(
    working,
    closureCommands.filter((command) =>
      downstreamCommandIdSet.has(command.id)
    ),
    historyIndex.commandOrdinalById
  );
  const collidingTransitionParentIds =
    findCollidingTransitionParentIdsFromState(
      working,
      validation.cellIds,
      discovered.component.supportCellIds,
      validation.level,
      resolvedOptions,
      faceResolution.tolerance
    );
  if (collidingTransitionParentIds.length === 0) {
    throw new Error(
      "history transaction could not isolate colliding transition parents after restoring downstream history"
    );
  }
  const supportCommandIdSet = new Set(
    historyClosure.supportCommandIds
  );
  reverseRefinementHistoryCommands(
    working,
    closureCommands.filter((command) =>
      supportCommandIdSet.has(command.id)
    ),
    historyIndex.commandOrdinalById
  );

  const supportCommands = discovered.supportCommands;
  const supportCommandIds = supportCommands.map(
    (command) => command.id
  );
  const originalSupportParentIds = stableCellIds(
    discovered.component.supportCellIds.map((cellId) => {
      const parentId = requiredSessionStateCell(working, cellId).parentId;
      if (parentId === undefined) {
        throw new Error(`supporting cell ${cellId} has no parent`);
      }
      return parentId;
    })
  );
  const previousCoreParentIds = stableCellIds(
    discovered.component.supportCellIds
      .filter((cellId) =>
        requiredSessionStateCell(working, cellId).role === "selected"
      )
      .map((cellId) => requiredSessionStateCell(working, cellId).parentId)
      .filter((parentId): parentId is CellId =>
        parentId !== undefined
      )
  );
  const rebuiltCoreParentIds = stableCellIds([
    ...previousCoreParentIds,
    ...collidingTransitionParentIds
  ]);
  const previousCoreParentIdSet =
    new Set(previousCoreParentIds);
  const addedParentCellIds = rebuiltCoreParentIds.filter(
    (cellId) => !previousCoreParentIdSet.has(cellId)
  );
  const attemptedAction: TwoToOneCompensationAction<CellId> = {
    kind: "transition-shell-rebuild",
    reason:
      "the nested core reached an existing 2:1 transition component",
    addedParentCellIds,
    replacedTransitionCellIds: [...collidingTransitionParentIds]
  };
  const compensation =
    resolvedOptions.normalizedTwoToOneCompensation;
  if (compensation === undefined) {
    throw new Error(
      "history transaction planning requires normalized compensation"
    );
  }
  if (
    addedParentCellIds.length > 0
    && (
      compensation.maxAddedParentLayers < 1
      || addedParentCellIds.length
        > compensation.maxAddedParentCount
    )
  ) {
    throw compensationLimitError(
      validation.cellIds,
      attemptedAction,
      compensation
    );
  }

  const retryOptions = replaySessionPatchOptions(
    currentRecipe.options,
    []
  );
  const authorizedCompletionParentIds = new Set<CellId>([
    ...originalSupportParentIds,
    ...discovered.component.boundaryCellIds
  ]);
  const rebuiltSupportPlan = buildCompletedRebuiltSupportPlanFromState(
    working,
    rebuiltCoreParentIds,
    authorizedCompletionParentIds,
    supportCommandIds,
    retryOptions,
    historyPlanningScope(working, context)
  );
  validateRebuiltSupportPlanOwnershipFromState(
    working,
    rebuiltSupportPlan.hiddenCellIds,
    originalSupportParentIds,
    supportCommands,
    faceResolution.tolerance
  );
  refineSessionPatchOnStateInternal(
    working,
    [...rebuiltSupportPlan.hiddenCellIds],
    retryOptions,
    rebuiltSupportPlan
  );

  const currentPlanningWorking = forkRefinementSessionOverlay(working);
  const preservedCommands =
    historyClosure.preservedCommandIds.map((commandId) => {
      const command = historyIndex.commandById.get(commandId);
      if (command === undefined) {
        throw new Error(
          `history closure references unknown preserved command ${commandId}`
        );
      }
      return command;
    });
  reverseRefinementHistoryCommands(
    currentPlanningWorking,
    preservedCommands,
    historyIndex.commandOrdinalById
  );
  const preReplayCurrentGeometryIndex =
    buildActiveRefinementGeometryIndexFromState(
      currentPlanningWorking,
      faceResolution.tolerance,
      transitionContextActiveCellIdsFromOverlay(
        currentPlanningWorking,
        context
      )
  );
  const preReplayRemappedCellIds =
    remapRefinementSessionHistoryRecipeCells(
      preReplayCurrentGeometryIndex,
      currentRecipe.selectedCellIds,
      currentRecipe.selectedCellGeometry,
      "current selection",
      closureCommandIds
    );
  const preReplayTransitionSupportCellIds =
    remapRefinementSessionHistoryRecipeCells(
      preReplayCurrentGeometryIndex,
      currentRecipe.transitionSupportCellIds,
      currentRecipe.transitionSupportCellGeometry,
      "current transition support",
      closureCommandIds
    );
  const currentPatchPlan = buildHistoryRefinementPatchPlan(
    currentPlanningWorking,
    [...preReplayRemappedCellIds],
    replaySessionPatchOptions(
      currentRecipe.options,
      preReplayTransitionSupportCellIds
    ),
    context
  );
  refineSessionPatchOnStateInternal(
    currentPlanningWorking,
    [...preReplayRemappedCellIds],
    replaySessionPatchOptions(
      currentRecipe.options,
      preReplayTransitionSupportCellIds
    ),
    currentPatchPlan
  );

  for (const commandId of historyClosure.downstreamCommandIds) {
    const historicalCommand =
      historyIndex.commandById.get(commandId);
    if (historicalCommand === undefined) {
      throw new Error(
        `history closure references unknown downstream command ${commandId}`
      );
    }
    const recipe = historicalCommand.recipe;
    if (recipe === undefined) {
      throw historyConflict(
        `history command ${commandId} has no replay recipe`,
        [],
        [commandId]
      );
    }
    const geometryIndex = buildActiveRefinementGeometryIndexFromState(
      working,
      faceResolution.tolerance,
      transitionContextActiveCellIdsFromOverlay(
        working,
        context
      )
    );
    const selectedCellIds =
      remapRefinementSessionHistoryRecipeCells(
      geometryIndex,
      recipe.selectedCellIds,
      recipe.selectedCellGeometry,
      "selection",
      [commandId]
    );
    const transitionSupportCellIds =
      remapRefinementSessionHistoryRecipeCells(
      geometryIndex,
      recipe.transitionSupportCellIds,
      recipe.transitionSupportCellGeometry,
      "transition support",
      [commandId]
    );
    const replayedCommand = refineSessionPatchOnStateInternal(
      working,
      [...selectedCellIds],
      replaySessionPatchOptions(
        recipe.options,
        transitionSupportCellIds
      ),
      buildHistoryRefinementPatchPlan(
        working,
        [...selectedCellIds],
        replaySessionPatchOptions(recipe.options, transitionSupportCellIds),
        context
      )
    );
    assertHistoryReplayCommandEquivalent(
      historicalCommand,
      replayedCommand,
      selectedCellIds,
      transitionSupportCellIds,
      commandId
    );
  }

  const currentGeometryIndex =
    buildActiveRefinementGeometryIndexFromState(
      working,
      faceResolution.tolerance,
      transitionContextActiveCellIdsFromOverlay(
        working,
        context
      )
    );
  const remappedCellIds =
    remapRefinementSessionHistoryRecipeCells(
      currentGeometryIndex,
      currentRecipe.selectedCellIds,
      currentRecipe.selectedCellGeometry,
      "current selection",
      closureCommandIds
    );
  const remappedTransitionSupportCellIds =
    remapRefinementSessionHistoryRecipeCells(
      currentGeometryIndex,
      currentRecipe.transitionSupportCellIds,
      currentRecipe.transitionSupportCellGeometry,
      "current transition support",
      closureCommandIds
    );
  if (
    !sameCellIdSet(
      remappedCellIds,
      preReplayRemappedCellIds
    )
    || !sameCellIdSet(
      remappedTransitionSupportCellIds,
      preReplayTransitionSupportCellIds
    )
  ) {
    throw historyConflict(
      "current request remapped to different cells after downstream replay",
      [
        ...preReplayRemappedCellIds,
        ...remappedCellIds,
        ...preReplayTransitionSupportCellIds,
        ...remappedTransitionSupportCellIds
      ],
      closureCommandIds
    );
  }
  const currentRequestCommand = refineSessionPatchOnStateInternal(
    working,
    [...remappedCellIds],
    replaySessionPatchOptions(
      currentRecipe.options,
      remappedTransitionSupportCellIds
    ),
    rebaseRefinementSessionPatchPlanFromState(
      working,
      currentPatchPlan,
      validation.level,
      replaySessionPatchOptions(
        currentRecipe.options,
        remappedTransitionSupportCellIds
      ),
      closureCommandIds,
      historyPlanningScope(working, context)
    )
  );

  const {
    createdCellIds,
    activeCreatedCellIds,
    reactivatedCellIds,
    hiddenCellIds
  } = summarizeRefinementSessionOverlayMutation(session, working);
  const quality = session.kind === "H1"
    ? auditNetHexCellReplacementQualityFromState(
        createDirectRefinementSessionState(
          session,
          exactActiveMergeKey
        ),
        hiddenCellIds,
        working,
        [...activeCreatedCellIds, ...reactivatedCellIds]
      )
    : undefined;
  if (quality !== undefined) {
    assertHexPatchQualitySummary(
      quality,
      "history transaction planning"
    );
  }
  const createdNodeIds = Array.from(
    { length: working.storage.appendedNodes.length },
    (_, index) => originalNodeCount + index + 1
  );
  const effectiveSelectedCellIds =
    activeSelectedCommandOutputCellIdsFromState(
      working,
      currentRequestCommand
    );
  const twoToOne: TwoToOneCapabilityReport<CellId> = {
    status: "compensated",
    topologyClass: "mixed-level",
    originalSelectedCellIds: [
      ...validation.cellIds
    ].sort(compareCellIds),
    effectiveSelectedCellIds,
    actions: [attemptedAction],
    affectedComponentCellIds: [...new Set([
      ...hiddenCellIds,
      ...activeCreatedCellIds,
      ...reactivatedCellIds
    ])].sort(compareCellIds),
    preservedFarFieldCellCount:
      session.activeLeafIds.size - hiddenCellIds.length
  };
  const command = freezeRefinementSessionCommand({
    id: compoundCommandId,
    kind: "refine",
    hiddenCellIds,
    createdCellIds,
    activeCreatedCellIds,
    reactivatedCellIds,
    createdNodeIds,
    ...(quality === undefined ? {} : { quality }),
    twoToOne,
    recipe: currentRecipe
  });
  restoreRefinementSessionOverlayHistory(
    working,
    historyCheckpoint
  );
  working.appendUndoCommand(command);
  working.clearRedoCommands();
  working.setNextCommandId(session.nextCommandId + 1);

  const conformanceProof = auditHistoryConformance(
    session, working, hiddenCellIds, [...activeCreatedCellIds, ...reactivatedCellIds],
    faceResolution, validation.cellIds, attemptedAction
  );
  const localBuild = buildTransitionContextActiveMesh(
    working,
    context
  );
  pruneInactiveRefinementSessionOverlayNodeOwners(working);
  const previewDelta = snapshotRefinementSessionOverlayDelta(working);
  const inputElementCount =
    resolvedOptions.activeBuild.mesh.elements.length;
  const preview: RefinementPreview<CellId> = {
    kind: session.kind,
    planMode: "aggregate",
    plan: [],
    compound: {
      kind: "transition-shell-rebuild"
    },
    summary: {
      inputElementCount,
      changedInputElementCount: hiddenCellIds.length,
      preservedInputElementCount:
        inputElementCount - hiddenCellIds.length,
      outputElementCount: inputElementCount
        - previewDelta.activeLeafRemovals.length
        + previewDelta.activeLeafAdditions.length
    },
    twoToOne: cloneTwoToOneCapabilityReport(twoToOne),
    ...(quality === undefined ? {} : { quality })
  };
  const overlayStats = Object.freeze(
    refinementSessionOverlayStats(working)
  );
  return finishHistoryConformancePlan(session, {
    historyClosure, context, localBuild, command,
    delta: previewDelta, overlayStats, preview,
    conformanceAudit: Object.freeze({
      mode: conformanceProof.mode,
      checkedElementCount: conformanceProof.checkedElementCount,
      requiredInterfaceCount: conformanceProof.requiredInterfaceCount
    })
  }, conformanceProof, publishBaseline);
}

function activeSelectedCommandOutputCellIds(
  session: RefinementSession,
  command: RefinementSessionCommand
): CellId[] {
  return stableCellIds([
    ...(
      command.activeCreatedCellIds
      ?? command.createdCellIds
    ),
    ...(command.reactivatedCellIds ?? [])
  ].filter((cellId) => {
    const cell = requiredCell(session, cellId);
    return cell.active
      && !cell.hidden
      && session.activeLeafIds.has(cellId)
      && cell.role === "selected";
  }));
}

function activeSelectedCommandOutputCellIdsFromState(
  state: RefinementSessionStateReader,
  command: RefinementSessionCommand
): CellId[] {
  return stableCellIds([
    ...(command.activeCreatedCellIds ?? command.createdCellIds),
    ...(command.reactivatedCellIds ?? [])
  ].filter((cellId) => {
    const cell = requiredSessionStateCell(state, cellId);
    return cell.active
      && !cell.hidden
      && state.hasActiveLeaf(cellId)
      && cell.role === "selected";
  }));
}

function summarizeRefinementSessionOverlayMutation(
  session: RefinementSession,
  overlay: RefinementSessionOverlay
): {
  createdCellIds: CellId[];
  activeCreatedCellIds: CellId[];
  reactivatedCellIds: CellId[];
  hiddenCellIds: CellId[];
} {
  const createdCellIds = [...overlay.storage.createdCells.keys()]
    .sort(compareCellIds);
  const activeCreatedCellIds = createdCellIds.filter((cellId) =>
    overlay.hasActiveLeaf(cellId)
  );
  const reactivatedCellIds = [...overlay.storage.activeLeafAdditions]
    .filter((cellId) =>
      session.cells.has(cellId)
      && !session.activeLeafIds.has(cellId)
      && overlay.hasActiveLeaf(cellId)
    )
    .sort(compareCellIds);
  const hiddenCellIds = [...overlay.storage.activeLeafRemovals]
    .filter((cellId) =>
      session.activeLeafIds.has(cellId)
      && !overlay.hasActiveLeaf(cellId)
    )
    .sort(compareCellIds);
  return {
    createdCellIds,
    activeCreatedCellIds,
    reactivatedCellIds,
    hiddenCellIds
  };
}

function pruneInactiveRefinementSessionOverlayNodeOwners(
  overlay: RefinementSessionOverlay
): void {
  for (const [key, ownerIds] of overlay.storage.ownerOverridesByNodeKey) {
    overlay.storage.ownerOverridesByNodeKey.set(
      key,
      ownerIds.filter((cellId) => overlay.hasActiveLeaf(cellId))
    );
  }
}

function planUntouchedTransitionShellHistoryTransaction(
  session: RefinementSession,
  cellIds: readonly CellId[],
  resolvedOptions: ResolvedRefinementSessionPatchOptions,
  faceResolution: SessionFaceResolution,
  discovered: DiscoveredTransitionHistoryComponent,
  historyIndex: RefinementHistoryIndex,
  publishBaseline: boolean
): RefinementSessionHistoryTransactionPlan {
  const compensation = resolvedOptions.normalizedTwoToOneCompensation;
  if (compensation === undefined) {
    throw new Error(
      "transition-shell rebuilding requires a normalized compensation snapshot"
    );
  }
  const validation = validateRefinementSessionSelection(
    session,
    [...cellIds]
  );
  if (!validation.ok || validation.level === undefined || validation.level < 1) {
    throw new Error(
      validation.errors.join("; ")
      || "transition-shell rebuilding requires a refined selection"
    );
  }
  const supportCommand = discovered.supportCommands[0];
  if (
    supportCommand === undefined
    || discovered.supportCommands.length !== 1
  ) {
    throw new Error(
      "untouched transition-shell planning requires one supporting root command"
    );
  }
  const working = createRefinementSessionOverlay(session, {
    nodeKey: exactActiveMergeKey,
    cellNodeIds: (cell) => cell.element
  });
  const historyCheckpoint =
    checkpointRefinementSessionOverlayHistory(working);
  const selectedLevel = validation.level;
  const faceTolerance = faceResolution.tolerance;
  const effectiveOptions: ResolvedRefinementSessionPatchOptions =
    faceResolution.mergeTolerance === undefined
      ? resolvedOptions
      : {
          ...resolvedOptions,
          mergeTolerance: faceResolution.mergeTolerance
        };
  const allSupportLayerCellIds = supportCommand.createdCellIds.filter(
    (cellId) => {
      const cell = working.cell(cellId);
      return cell?.level === selectedLevel
        && cell.parentId !== undefined;
    }
  );
  if (allSupportLayerCellIds.length === 0) {
    throw new Error(
      "automatic transition-shell rebuilding could not find the supporting refinement layer"
    );
  }
  const supportLayerCellIds = collectConnectedSupportLayerCellsFromState(
    working,
    allSupportLayerCellIds,
    validation.cellIds,
    faceTolerance
  );
  const collidingTransitionParentIds =
    findCollidingTransitionParentIdsFromState(
      working,
      validation.cellIds,
      supportLayerCellIds,
      selectedLevel,
      effectiveOptions,
      faceTolerance
    );
  if (collidingTransitionParentIds.length === 0) {
    throw new Error(
      "automatic transition-shell rebuilding could not isolate the colliding transition parents"
    );
  }
  const nonLeafSupportCellIds = supportLayerCellIds.filter((cellId) => {
    const cell = requiredSessionStateCell(working, cellId);
    return !cell.active
      || cell.hidden
      || !working.hasActiveLeaf(cellId);
  });
  if (nonLeafSupportCellIds.length > 0) {
    throw historyConflict(
      `automatic transition-shell rebuilding requires an untouched supporting layer: ${nonLeafSupportCellIds.join(", ")}`,
      nonLeafSupportCellIds,
      [
        supportCommand.id,
        ...historyCommandIdsForHiddenCells(
          session,
          nonLeafSupportCellIds
        )
      ]
    );
  }

  const affectedInputCellIds = traceLocalSupportCommandInputCellIds(
    session,
    supportCommand,
    discovered.component.supportCellIds
  );
  const includedCommandIds = new Set([supportCommand.id]);
  const boundaryCellIds = affectedInputCellIds.filter((cellId) => {
    const creatorCommandId =
      historyIndex.creatorCommandIdByCellId.get(cellId);
    return creatorCommandId === undefined
      || !includedCommandIds.has(creatorCommandId);
  });
  const historyClosure: RefinementHistoryClosure = Object.freeze({
    supportCommandIds: Object.freeze([supportCommand.id]),
    downstreamCommandIds: Object.freeze([]),
    affectedInputCellIds: Object.freeze(affectedInputCellIds),
    preservedCommandIds: Object.freeze(
      session.undoStack
        .filter((entry) => entry.id !== supportCommand.id)
        .map((entry) => entry.id)
    ),
    boundaryCellIds: Object.freeze(boundaryCellIds)
  });
  const contextComponent = completeTransitionHistoryComponent(
    session,
    discovered,
    collidingTransitionParentIds
  );
  const context = buildTransitionRebuildContext(
    session,
    validation.cellIds,
    contextComponent.component,
    historyClosure,
    faceResolution
  );
  const compoundCommandId = `cmd-${session.nextCommandId}`;
  const selectedGeometryKeys = validation.cellIds.map((cellId) =>
    refinementCellGeometryKeyFromState(
      working,
      requiredSessionStateCell(working, cellId)
    )
  );
  const originalSupportParentIds = stableCellIds(
    supportLayerCellIds.map((cellId) => {
      const parentId = requiredSessionStateCell(working, cellId).parentId;
      if (parentId === undefined) {
        throw new Error(`supporting cell ${cellId} has no parent`);
      }
      return parentId;
    })
  );
  const previousCoreParentIds = stableCellIds(
    supportLayerCellIds
      .filter((cellId) =>
        requiredSessionStateCell(working, cellId).role === "selected"
      )
      .map((cellId) =>
        requiredSessionStateCell(working, cellId).parentId
      )
      .filter((parentId): parentId is CellId => parentId !== undefined)
  );
  const rebuiltCoreParentIds = stableCellIds([
    ...previousCoreParentIds,
    ...collidingTransitionParentIds
  ]);
  const previousCoreParentIdSet = new Set(previousCoreParentIds);
  const addedParentCellIds = rebuiltCoreParentIds.filter(
    (cellId) => !previousCoreParentIdSet.has(cellId)
  );
  const attemptedAction: TwoToOneCompensationAction<CellId> = {
    kind: "transition-shell-rebuild",
    reason:
      "the nested core reached an existing 2:1 transition component",
    addedParentCellIds,
    replacedTransitionCellIds: [...collidingTransitionParentIds]
  };
  if (
    addedParentCellIds.length > 0
    && (
      compensation.maxAddedParentLayers < 1
      || addedParentCellIds.length > compensation.maxAddedParentCount
    )
  ) {
    throw compensationLimitError(
      validation.cellIds,
      attemptedAction,
      compensation
    );
  }

  for (const cellId of supportLayerCellIds) {
    const cell = working.mutableCell(cellId);
    cell.active = false;
    cell.hidden = true;
    working.removeActiveLeaf(cellId);
  }
  for (const parentId of originalSupportParentIds) {
    const parent = working.mutableCell(parentId);
    parent.active = true;
    parent.hidden = false;
    working.addActiveLeaf(parentId);
  }
  const authorizedCompletionParentIds =
    collectAuthorizedCompletionParentIdsFromState(
      working,
      originalSupportParentIds,
      [supportCommand],
      selectedLevel - 1,
      faceTolerance,
      historyPlanningScope(working, context).activeCellIds
    );
  const retryOptions: RefinementSessionPatchOptions = {
    ...effectiveOptions,
    rebuildExistingTransitions: compensation.mode !== "none"
  };
  delete retryOptions.activeBuild;
  delete retryOptions.transitionSupportCellIds;
  const rebuiltSupportPlan = buildCompletedRebuiltSupportPlanFromState(
    working,
    rebuiltCoreParentIds,
    authorizedCompletionParentIds,
    [supportCommand.id],
    retryOptions,
    historyPlanningScope(working, context)
  );
  validateRebuiltSupportPlanOwnershipFromState(
    working,
    rebuiltSupportPlan.hiddenCellIds,
    originalSupportParentIds,
    [supportCommand],
    faceTolerance
  );
  const rebuiltSupportCommand = refineSessionPatchOnStateInternal(
    working,
    [...rebuiltSupportPlan.hiddenCellIds],
    retryOptions,
    rebuiltSupportPlan
  );
  const rebuiltSelectedCellsByGeometry = new Map<string, CellId>();
  for (const cellId of rebuiltSupportCommand.createdCellIds) {
    const cell = requiredSessionStateCell(working, cellId);
    if (
      cell.level === selectedLevel
      && cell.role === "selected"
      && cell.active
    ) {
      rebuiltSelectedCellsByGeometry.set(
        refinementCellGeometryKeyFromState(working, cell),
        cellId
      );
    }
  }
  const remappedCellIds = selectedGeometryKeys.map((key) => {
    const cellId = rebuiltSelectedCellsByGeometry.get(key);
    if (cellId === undefined) {
      throw new Error(
        "automatic transition-shell rebuilding could not preserve the selected fine-cell geometry"
      );
    }
    return cellId;
  });
  const currentRequestCommand = refineSessionPatchOnStateInternal(
    working,
    remappedCellIds,
    retryOptions,
    buildHistoryRefinementPatchPlan(working, remappedCellIds, retryOptions, context)
  );
  const {
    createdCellIds,
    activeCreatedCellIds,
    reactivatedCellIds,
    hiddenCellIds
  } = summarizeRefinementSessionOverlayMutation(session, working);
  const quality = session.kind === "H1"
    ? auditNetHexCellReplacementQualityFromState(
        createDirectRefinementSessionState(session, exactActiveMergeKey),
        hiddenCellIds,
        working,
        [...activeCreatedCellIds, ...reactivatedCellIds]
      )
    : undefined;
  if (quality !== undefined) {
    assertHexPatchQualitySummary(
      quality,
      "automatic transition-shell rebuilding"
    );
  }
  const createdNodeIds = Array.from(
    { length: working.storage.appendedNodes.length },
    (_, index) => session.nodes.length + index + 1
  );
  const twoToOne: TwoToOneCapabilityReport<CellId> = {
    status: "compensated",
    topologyClass: "mixed-level",
    originalSelectedCellIds: [...validation.cellIds].sort(compareCellIds),
    effectiveSelectedCellIds: activeSelectedCommandOutputCellIdsFromState(
      working,
      currentRequestCommand
    ),
    actions: [attemptedAction],
    affectedComponentCellIds: [...new Set([
      ...hiddenCellIds,
      ...activeCreatedCellIds,
      ...reactivatedCellIds
    ])].sort(compareCellIds),
    preservedFarFieldCellCount:
      session.activeLeafIds.size - hiddenCellIds.length
  };
  const recipe = createRefinementSessionCommandRecipe(
    session,
    validation.cellIds,
    effectiveOptions
  );
  const command = freezeRefinementSessionCommand({
    id: compoundCommandId,
    kind: "refine",
    hiddenCellIds,
    createdCellIds,
    activeCreatedCellIds,
    reactivatedCellIds,
    createdNodeIds,
    ...(quality === undefined ? {} : { quality }),
    twoToOne,
    recipe
  });
  restoreRefinementSessionOverlayHistory(working, historyCheckpoint);
  working.appendUndoCommand(command);
  working.clearRedoCommands();
  working.setNextCommandId(session.nextCommandId + 1);

  const conformanceProof = auditHistoryConformance(
    session, working, hiddenCellIds, [...activeCreatedCellIds, ...reactivatedCellIds],
    faceResolution, validation.cellIds, attemptedAction
  );
  const localBuild = buildTransitionContextActiveMesh(
    working,
    context
  );
  pruneInactiveRefinementSessionOverlayNodeOwners(working);
  const previewDelta = snapshotRefinementSessionOverlayDelta(working);
  const inputElementCount = resolvedOptions.activeBuild.mesh.elements.length;
  const preview: RefinementPreview<CellId> = {
    kind: session.kind,
    planMode: "aggregate",
    plan: [],
    compound: { kind: "transition-shell-rebuild" },
    summary: {
      inputElementCount,
      changedInputElementCount: hiddenCellIds.length,
      preservedInputElementCount:
        inputElementCount - hiddenCellIds.length,
      outputElementCount: inputElementCount
        - previewDelta.activeLeafRemovals.length
        + previewDelta.activeLeafAdditions.length
    },
    twoToOne: cloneTwoToOneCapabilityReport(twoToOne),
    ...(quality === undefined ? {} : { quality })
  };
  return finishHistoryConformancePlan(session, {
    historyClosure, context, localBuild, command,
    delta: previewDelta,
    overlayStats: Object.freeze(refinementSessionOverlayStats(working)),
    preview,
    conformanceAudit: Object.freeze({
      mode: conformanceProof.mode,
      checkedElementCount: conformanceProof.checkedElementCount,
      requiredInterfaceCount: conformanceProof.requiredInterfaceCount
    })
  }, conformanceProof, publishBaseline);
}

function traceLocalSupportCommandInputCellIds(
  session: RefinementSession,
  command: RefinementSessionCommand,
  supportCellIds: readonly CellId[]
): CellId[] {
  const commandInputCellIds = stableCellIds([
    ...command.hiddenCellIds,
    ...(command.reactivatedCellIds ?? [])
  ]);
  const commandInputCellIdSet = new Set(commandInputCellIds);
  const reachedInputCellIds = new Set<CellId>();
  const supportAncestorGeometryKeys = new Set<string>();
  for (const supportCellId of supportCellIds) {
    let currentCellId: CellId | undefined = supportCellId;
    const visitedCellIds = new Set<CellId>();
    while (
      currentCellId !== undefined
      && !visitedCellIds.has(currentCellId)
    ) {
      visitedCellIds.add(currentCellId);
      const currentCell = requiredCell(session, currentCellId);
      supportAncestorGeometryKeys.add(
        refinementCellGeometryKey(session, currentCell)
      );
      if (commandInputCellIdSet.has(currentCellId)) {
        reachedInputCellIds.add(currentCellId);
        break;
      }
      currentCellId = currentCell.parentId;
    }
  }
  for (const commandInputCellId of commandInputCellIds) {
    if (reachedInputCellIds.has(commandInputCellId)) {
      continue;
    }
    const inputCell = requiredCell(session, commandInputCellId);
    if (
      supportAncestorGeometryKeys.has(
        refinementCellGeometryKey(session, inputCell)
      )
    ) {
      reachedInputCellIds.add(commandInputCellId);
    }
  }
  return commandInputCellIds.filter((cellId) =>
    reachedInputCellIds.has(cellId)
  );
}

interface TransitionHistoryComponent {
  readonly selectedCellIds: readonly CellId[];
  readonly supportCellIds: readonly CellId[];
  readonly collidingTransitionParentIds: readonly CellId[];
  readonly componentCellIds: ReadonlySet<CellId>;
  readonly boundaryCellIds: readonly CellId[];
}

interface DiscoveredTransitionHistoryComponent {
  readonly component: TransitionHistoryComponent;
  readonly supportCommands: readonly RefinementSessionCommand[];
}

function buildTransitionRebuildContext(
  session: RefinementSession,
  selectedCellIds: readonly CellId[],
  component: TransitionHistoryComponent,
  historyClosure: RefinementHistoryClosure,
  faceResolution: SessionFaceResolution
): TransitionRebuildContext {
  const activeComponentCellIds = stableCellIds(
    [...session.activeLeafIds].filter((cellId) =>
      component.componentCellIds.has(cellId)
    )
  );
  const componentFaceIndex = createSessionFaceIndex(
    faceResolution.tolerance
  );
  for (const cellId of activeComponentCellIds) {
    const cell = requiredCell(session, cellId);
    for (const face of refinementCellFaces(session, cell)) {
      componentFaceIndex.add(face);
    }
  }

  const activeComponentCellIdSet = new Set(
    activeComponentCellIds
  );
  const boundaryCellIdSet = new Set<CellId>();
  const boundaryFaces: ImmutableBoundaryFacePartition[] = [];
  for (const cellId of stableCellIds(session.activeLeafIds)) {
    if (activeComponentCellIdSet.has(cellId)) {
      continue;
    }
    const cell = requiredCell(session, cellId);
    for (const face of refinementCellFaces(session, cell)) {
      const match = componentFaceIndex.uniqueMatch(face);
      if (match === undefined) {
        continue;
      }
      boundaryCellIdSet.add(cellId);
      boundaryFaces.push({
        ownerCellId: cellId,
        adjacentComponentCellId: match.owner,
        nodeIds: [...face.nodeIds],
        points: face.points.map((point) => [...point])
      });
    }
  }
  boundaryFaces.sort((first, second) =>
    compareCellIds(first.ownerCellId, second.ownerCellId)
    || compareCellIds(
      first.adjacentComponentCellId,
      second.adjacentComponentCellId
    )
    || first.nodeIds.join(":").localeCompare(
      second.nodeIds.join(":")
    )
  );
  const boundaryCellIds = stableCellIds(boundaryCellIdSet);
  const ancestorCellIdSet = new Set<CellId>();
  for (const cellId of stableCellIds([
    ...selectedCellIds,
    ...component.supportCellIds,
    ...activeComponentCellIds,
    ...boundaryCellIds
  ])) {
    let parentId = requiredCell(session, cellId).parentId;
    while (parentId !== undefined) {
      if (!session.cells.has(parentId) && boundaryCellIdSet.has(cellId)) {
        // Boundary provenance is checked by support-ownership validation.
        break;
      }
      if (ancestorCellIdSet.has(parentId)) {
        break;
      }
      ancestorCellIdSet.add(parentId);
      parentId = requiredCell(session, parentId).parentId;
    }
  }
  const ancestorCellIds = stableCellIds(ancestorCellIdSet);
  const referencedNodeIdSet = new Set<number>();
  for (const cellId of stableCellIds([
    ...activeComponentCellIds,
    ...boundaryCellIds,
    ...ancestorCellIds
  ])) {
    for (const nodeId of requiredCell(session, cellId).element) {
      referencedNodeIdSet.add(nodeId);
    }
  }
  const referencedNodeIds = [...referencedNodeIdSet]
    .sort((left, right) => left - right);
  return createTransitionRebuildContextInternal({
    selectedCellIds: stableCellIds(selectedCellIds),
    supportCellIds: stableCellIds(component.supportCellIds),
    ancestorCellIds,
    boundaryCellIds,
    activeComponentCellIds,
    referencedNodeIds,
    supportCommandIds: historyClosure.supportCommandIds,
    downstreamCommandIds: historyClosure.downstreamCommandIds,
    boundaryFaces,
    faceResolution
  });
}

function transitionContextActiveCellIdsFromOverlay(
  overlay: RefinementSessionOverlay,
  context: TransitionRebuildContext
): CellId[] {
  const candidateIds = new Set<CellId>([
    ...context.selectedCellIds,
    ...context.supportCellIds,
    ...context.ancestorCellIds,
    ...context.activeComponentCellIds,
    ...context.boundaryCellIds,
    ...overlay.storage.createdCells.keys(),
    ...overlay.storage.activeLeafAdditions
  ]);
  // Include edge/corner neighbors of restored ancestors as well as face neighbors.
  // Snapshot the seed list so this remains one ring, not a flood into the far field.
  for (const id of [...candidateIds]) {
    const cell = overlay.cell(id);
    if (cell === undefined) continue;
    for (const nodeId of cell.element) {
      const point = activeSessionStateNode(overlay, nodeId, id);
      for (const ownerId of overlay.activeOwnersByNodeKey(exactActiveMergeKey(point))) {
        candidateIds.add(ownerId);
      }
    }
  }
  return [...candidateIds]
    .filter((cellId) =>
      overlay.cell(cellId) !== undefined
      && overlay.hasActiveLeaf(cellId)
    )
    .sort((left, right) => {
      const leftCell = requiredSessionStateCell(overlay, left);
      const rightCell = requiredSessionStateCell(overlay, right);
      return leftCell.ordinal - rightCell.ordinal
        || compareCellIds(left, right);
    });
}

function buildTransitionContextActiveMesh(
  overlay: RefinementSessionOverlay,
  context: TransitionRebuildContext
): ActiveMeshBuildResult {
  const mergeTolerance =
    context.faceResolution.mergeTolerance
    ?? context.faceResolution.tolerance;
  return buildActiveMeshForStateCellIdsWithMap(
    overlay,
    transitionContextActiveCellIdsFromOverlay(overlay, context),
    {
      mergeNodes: true,
      mergeTolerance,
      includeSessionNodeIdByNodeId: true,
      includeSessionNodeIdsByNodeId: true,
      includeCellIdByElementId: true,
      includeElementIdByCellId: true
    },
    {
      coordinateScale: context.faceResolution.coordinateScale,
      minimumElementEdgeLength:
        context.faceResolution.minimumElementEdgeLength
    }
  );
}

function discoverTransitionHistorySupportComponent(
  session: RefinementSession,
  selectedCellIds: readonly CellId[],
  selectedLevel: number,
  tolerance: number
): DiscoveredTransitionHistoryComponent {
  const supportCommands = findSupportCommands(
    session,
    selectedCellIds
  );
  const supportOutputCellIds = stableCellIds(
    supportCommands.flatMap((supportCommand) => [
      ...(
        supportCommand.activeCreatedCellIds
        ?? supportCommand.createdCellIds
      ),
      ...(supportCommand.reactivatedCellIds ?? [])
    ])
  );
  const allSupportCellIds = supportOutputCellIds.filter(
    (cellId) => {
      const cell = session.cells.get(cellId);
      return cell?.level === selectedLevel
        && cell.parentId !== undefined;
    }
  );
  if (allSupportCellIds.length === 0) {
    throw new Error(
      "history transaction could not find the supporting refinement layer"
    );
  }
  const supportCellIds = collectConnectedSupportLayerCells(
    session,
    allSupportCellIds,
    selectedCellIds,
    tolerance
  );
  const supportParentIds = stableCellIds(
    supportCellIds.map((cellId) => {
      const parentId = requiredCell(session, cellId).parentId;
      if (parentId === undefined) {
        throw new Error(`supporting cell ${cellId} has no parent`);
      }
      return parentId;
    })
  );
  const authorizedCompletionParentIds =
    collectAuthorizedCompletionParentIds(
      session,
      supportParentIds,
      supportCommands,
      selectedLevel - 1,
      tolerance
    );
  const supportParentIdSet = new Set(supportParentIds);
  const boundaryCellIds = stableCellIds(
    [...authorizedCompletionParentIds].filter(
      (cellId) => !supportParentIdSet.has(cellId)
    )
  );
  const componentCellIds = new Set<CellId>();
  for (const cellId of [
    ...selectedCellIds,
    ...supportCellIds,
    ...supportParentIds,
    ...boundaryCellIds
  ]) {
    collectRefinementCellDescendants(
      session,
      cellId,
      componentCellIds
    );
  }
  return {
    supportCommands: Object.freeze([...supportCommands]),
    component: {
      selectedCellIds: Object.freeze(
        stableCellIds(selectedCellIds)
      ),
      supportCellIds: Object.freeze([...supportCellIds]),
      collidingTransitionParentIds: Object.freeze([]),
      componentCellIds,
      boundaryCellIds: Object.freeze(boundaryCellIds)
    }
  };
}

function completeTransitionHistoryComponent(
  session: RefinementSession,
  discovered: DiscoveredTransitionHistoryComponent,
  collidingTransitionParentIds: readonly CellId[]
): DiscoveredTransitionHistoryComponent {
  if (collidingTransitionParentIds.length === 0) {
    throw new Error(
      "history transaction could not isolate colliding transition parents"
    );
  }
  const componentCellIds = new Set(
    discovered.component.componentCellIds
  );
  for (const cellId of collidingTransitionParentIds) {
    collectRefinementCellDescendants(
      session,
      cellId,
      componentCellIds
    );
  }
  return {
    supportCommands: discovered.supportCommands,
    component: {
      ...discovered.component,
      collidingTransitionParentIds: Object.freeze([
        ...collidingTransitionParentIds
      ]),
      componentCellIds
    }
  };
}

function cellHasDownstreamHistoryTrace(
  session: RefinementSession,
  historyIndex: RefinementHistoryIndex,
  cellId: CellId,
  downstreamCommandIds: ReadonlySet<string>
): boolean {
  if (downstreamCommandIds.size === 0) {
    return false;
  }
  const descendantCellIds = new Set<CellId>();
  collectRefinementCellDescendants(
    session,
    cellId,
    descendantCellIds
  );
  for (const descendantCellId of descendantCellIds) {
    const creatorCommandId =
      historyIndex.creatorCommandIdByCellId.get(descendantCellId);
    if (
      creatorCommandId !== undefined
      && downstreamCommandIds.has(creatorCommandId)
    ) {
      return true;
    }
    const consumerCommandIds =
      historyIndex.consumerCommandIdsByCellId.get(
        descendantCellId
      ) ?? [];
    if (consumerCommandIds.some((commandId) =>
      downstreamCommandIds.has(commandId)
    )) {
      return true;
    }
  }
  return false;
}

function buildSessionHistoryIndex(
  session: RefinementSession
): RefinementHistoryIndex {
  try {
    return buildRefinementHistoryIndex(
      session.undoStack,
      [...session.cells.keys()]
    );
  } catch (error) {
    if (error instanceof RefinementHistoryClosureError) {
      throw historyConflict(
        error.message,
        error.cellIds,
        error.commandIds
      );
    }
    throw error;
  }
}

function buildSessionHistoryClosure(
  historyIndex: RefinementHistoryIndex,
  component: TransitionHistoryComponent,
  seedCellIds: readonly CellId[]
): RefinementHistoryClosure {
  try {
    return buildRefinementHistoryClosure(
      historyIndex,
      {
        seedCellIds,
        componentCellIds: component.componentCellIds
      }
    );
  } catch (error) {
    if (error instanceof RefinementHistoryClosureError) {
      const crossingCommandIds =
        error.message
          === "history closure crosses the component boundary"
          ? error.commandIds.filter((commandId) => {
              const command =
                historyIndex.commandById.get(commandId);
              if (command === undefined) {
                return true;
              }
              const affectedCellIds = [
                ...command.hiddenCellIds,
                ...command.createdCellIds,
                ...(command.activeCreatedCellIds ?? []),
                ...(command.reactivatedCellIds ?? []),
                ...(command.recipe?.selectedCellIds ?? []),
                ...(
                  command.recipe?.transitionSupportCellIds
                  ?? []
                )
              ];
              return affectedCellIds.some((cellId) =>
                component.componentCellIds.has(cellId)
              ) && affectedCellIds.some((cellId) =>
                !component.componentCellIds.has(cellId)
              );
            })
          : error.commandIds;
      throw historyConflict(
        error.message,
        error.cellIds,
        crossingCommandIds.length > 0
          ? crossingCommandIds
          : error.commandIds
      );
    }
    throw error;
  }
}

function assertHistorySupportCommands(
  historyClosure: RefinementHistoryClosure,
  discovered: DiscoveredTransitionHistoryComponent
): void {
  const discoveredCommandIds = discovered.supportCommands.map(
    (command) => command.id
  );
  if (sameSortedStrings(
    historyClosure.supportCommandIds,
    discoveredCommandIds
  )) {
    return;
  }
  throw historyConflict(
    "history transaction support roots changed during closure planning",
    discovered.component.supportCellIds,
    [
      ...discoveredCommandIds,
      ...historyClosure.supportCommandIds
    ]
  );
}

export function isRefinementSessionHistoryCommandRecipeReplayEligible(
  command: RefinementSessionCommand
): boolean {
  if ((command.reactivatedCellIds?.length ?? 0) > 0) {
    return false;
  }
  if (
    command.activeCreatedCellIds !== undefined
    && !sameCellIdSet(
      command.activeCreatedCellIds,
      command.createdCellIds
    )
  ) {
    return false;
  }
  return !command.twoToOne?.actions.some(
    (action) => action.kind === "transition-shell-rebuild"
  );
}

function assertEligibleDownstreamHistoryCommands(
  historyIndex: RefinementHistoryIndex,
  historyClosure: RefinementHistoryClosure
): void {
  for (const commandId of historyClosure.downstreamCommandIds) {
    const command = historyIndex.commandById.get(commandId);
    if (command === undefined) {
      throw new Error(
        `history closure references unknown downstream command ${commandId}`
      );
    }
    if (
      isRefinementSessionHistoryCommandRecipeReplayEligible(
        command
      )
    ) {
      continue;
    }
    throw historyConflict(
      `history command ${commandId} cannot be replayed from its recipe without compound effects`,
      historyReplayCompoundEffectCellIds(command),
      [commandId]
    );
  }
}

function historyReplayCompoundEffectCellIds(
  command: RefinementSessionCommand
): CellId[] {
  const activeCreatedCellIds = new Set(
    command.activeCreatedCellIds ?? command.createdCellIds
  );
  const inactiveCreatedCellIds = command.createdCellIds.filter(
    (cellId) => !activeCreatedCellIds.has(cellId)
  );
  const shellEffectCellIds = command.twoToOne?.actions.flatMap(
    (action) => action.kind === "transition-shell-rebuild"
      ? [
          ...action.addedParentCellIds,
          ...action.replacedTransitionCellIds
        ]
      : []
  ) ?? [];
  return stableCellIds([
    ...(command.reactivatedCellIds ?? []),
    ...inactiveCreatedCellIds,
    ...shellEffectCellIds
  ]);
}

function collectRefinementCellDescendants(
  session: RefinementSession,
  rootCellId: CellId,
  cellIds: Set<CellId>
): void {
  const pending = [rootCellId];
  while (pending.length > 0) {
    const cellId = pending.pop()!;
    if (cellIds.has(cellId)) {
      continue;
    }
    const cell = requiredCell(session, cellId);
    cellIds.add(cellId);
    pending.push(...cell.children);
  }
}

function collectRefinementCellDescendantsFromState(
  state: Pick<RefinementSessionStateReader, "cell">,
  rootCellId: CellId,
  cellIds: Set<CellId>
): void {
  const pending = [rootCellId];
  while (pending.length > 0) {
    const cellId = pending.pop()!;
    if (cellIds.has(cellId)) {
      continue;
    }
    const cell = requiredSessionStateCell(state, cellId);
    cellIds.add(cellId);
    pending.push(...cell.children);
  }
}

function reverseRefinementHistoryCommands(
  state: RefinementSessionStateWriter,
  commands: readonly RefinementSessionCommand[],
  commandOrdinalById: ReadonlyMap<string, number>
): void {
  const descendingCommands = [...commands].sort(
    (first, second) => {
      const firstOrdinal = commandOrdinalById.get(first.id);
      const secondOrdinal = commandOrdinalById.get(second.id);
      if (
        firstOrdinal === undefined
        || secondOrdinal === undefined
      ) {
        throw new Error(
          "history reversal requires an ordinal for every command"
        );
      }
      return secondOrdinal - firstOrdinal;
    }
  );
  for (const command of descendingCommands) {
    assertHistoryStateCellsReadyForActiveMutation(
      state,
      command.activeCreatedCellIds ?? command.createdCellIds
    );
    assertHistoryStateCellsReadyForActiveMutation(
      state,
      command.reactivatedCellIds ?? []
    );
    assertHistoryStateCellsReadyForActiveMutation(state, command.hiddenCellIds);
  }
  assertReversedHistoryHierarchy(state, descendingCommands);
  for (const command of descendingCommands) {
    for (
      const cellId of
        command.activeCreatedCellIds ?? command.createdCellIds
    ) {
      const cell = requiredStateMutableCell(state, cellId);
      cell.active = false;
      cell.hidden = true;
      state.removeActiveLeaf(cellId);
    }
    for (const cellId of command.reactivatedCellIds ?? []) {
      const cell = requiredStateMutableCell(state, cellId);
      cell.active = false;
      cell.hidden = true;
      state.removeActiveLeaf(cellId);
    }
    for (const cellId of command.hiddenCellIds) {
      const cell = requiredStateMutableCell(state, cellId);
      cell.active = true;
      cell.hidden = false;
      state.addActiveLeaf(cellId);
    }
  }
}

export function assertActivatedRefinementSessionCellsHaveNoActiveRelations(
  session: Pick<RefinementSession, "cells">,
  activatedCellIds: readonly CellId[]
): void {
  assertActivatedRefinementSessionCellsHaveNoActiveRelationsFromState(
    { cell: (cellId) => session.cells.get(cellId) },
    activatedCellIds
  );
}

function assertActivatedRefinementSessionCellsHaveNoActiveRelationsFromState(
  state: Pick<RefinementSessionStateReader, "cell">,
  activatedCellIds: readonly CellId[]
): void {
  const visitedAncestorIds = new Set<CellId>();
  const visitedDescendantIds = new Set<CellId>();
  for (const activatedCellId of new Set(activatedCellIds)) {
    const activatedCell = requiredHierarchyCell(
      state,
      activatedCellId
    );
    if (!activatedCell.active || activatedCell.hidden) {
      throw new Error(
        `reversed hidden cell ${activatedCellId} is not active`
      );
    }

    let descendantId = activatedCellId;
    let ancestorId = activatedCell.parentId;
    while (ancestorId !== undefined) {
      if (visitedAncestorIds.has(ancestorId)) {
        break;
      }
      const ancestor = requiredHierarchyCell(state, ancestorId);
      if (ancestor.active && !ancestor.hidden) {
        throw new Error(
          `active cell ${ancestorId} has active descendant ${descendantId}`
        );
      }
      visitedAncestorIds.add(ancestorId);
      descendantId = ancestorId;
      ancestorId = ancestor.parentId;
    }

    const pending = [...activatedCell.children];
    while (pending.length > 0) {
      const descendantId = pending.pop()!;
      if (visitedDescendantIds.has(descendantId)) {
        continue;
      }
      visitedDescendantIds.add(descendantId);
      const descendant = requiredHierarchyCell(
        state,
        descendantId
      );
      if (descendant.active && !descendant.hidden) {
        throw new Error(
          `active cell ${activatedCellId} has active descendant ${descendantId}`
        );
      }
      pending.push(...descendant.children);
    }
  }
}

function requiredHierarchyCell(
  state: Pick<RefinementSessionStateReader, "cell">,
  cellId: CellId
): RefinementSessionCell {
  const cell = state.cell(cellId);
  if (cell === undefined) {
    throw new Error(`unknown refinement cell ${cellId}`);
  }
  return cell;
}

function requiredStateCell(
  state: Pick<RefinementSessionStateReader, "cell">,
  cellId: CellId
): RefinementSessionCell {
  const cell = state.cell(cellId);
  if (cell === undefined) {
    throw new Error(`cell ${cellId} does not exist`);
  }
  return cell;
}

function requiredStateMutableCell(
  state: RefinementSessionStateWriter,
  cellId: CellId
): MutableRefinementSessionCell {
  requiredStateCell(state, cellId);
  return state.mutableCell(cellId);
}

function assertHistoryStateCellsReadyForActiveMutation(
  state: Pick<RefinementSessionStateReader, "cell" | "node">,
  cellIds: readonly CellId[]
): void {
  for (const cellId of cellIds) {
    const cell = requiredStateCell(state, cellId);
    for (const nodeId of cell.element) {
      const point = state.node(nodeId);
      if (point === undefined) {
        throw new Error(
          `active cell ${cell.id} references missing node ${nodeId}`
        );
      }
      exactActiveMergeKey(point);
    }
  }
}

function assertReversedHistoryHierarchy(
  state: Pick<RefinementSessionStateReader, "cell">,
  commands: readonly RefinementSessionCommand[]
): void {
  const overrides = new Map<CellId, { active: boolean; hidden: boolean }>();
  const predictedState: Pick<RefinementSessionStateReader, "cell"> = {
    cell(cellId) {
      const cell = state.cell(cellId);
      if (cell === undefined) {
        return undefined;
      }
      const override = overrides.get(cellId);
      return override === undefined ? cell : { ...cell, ...override };
    }
  };
  for (const command of commands) {
    for (const cellId of command.activeCreatedCellIds ?? command.createdCellIds) {
      overrides.set(cellId, { active: false, hidden: true });
    }
    for (const cellId of command.reactivatedCellIds ?? []) {
      overrides.set(cellId, { active: false, hidden: true });
    }
    for (const cellId of command.hiddenCellIds) {
      overrides.set(cellId, { active: true, hidden: false });
    }
    assertActivatedRefinementSessionCellsHaveNoActiveRelationsFromState(
      predictedState,
      command.hiddenCellIds
    );
  }
}

function buildActiveRefinementGeometryIndex(
  session: RefinementSession,
  tolerance: number
): RefinementCellGeometryIndex {
  const index = new RefinementCellGeometryIndex(tolerance);
  for (const cellId of sortedActiveLeafIdsSnapshot(session)) {
    index.add(
      cellId,
      snapshotRefinementCellGeometry(session, cellId)
    );
  }
  return index;
}

function buildActiveRefinementGeometryIndexFromState(
  state: RefinementSessionStateReader,
  tolerance: number,
  activeCellIds: readonly CellId[] =
    sortedActiveLeafIdsFromSessionState(state)
): RefinementCellGeometryIndex {
  const index = new RefinementCellGeometryIndex(tolerance);
  for (const cellId of activeCellIds) {
    index.add(
      cellId,
      refinementCellGeometrySnapshotFromState(state, cellId)
    );
  }
  return index;
}

export function remapRefinementSessionHistoryRecipeCells(
  index: RefinementCellGeometryIndex,
  originalCellIds: readonly CellId[],
  geometries: readonly RefinementCellGeometrySnapshot[],
  label: string,
  historyCommandIds: readonly string[]
): CellId[] {
  if (originalCellIds.length !== geometries.length) {
    throw historyConflict(
      `${label} replay recipe has mismatched cell and geometry counts`,
      originalCellIds,
      historyCommandIds
    );
  }
  const remappedCellIds: CellId[] = [];
  for (const [geometryIndex, geometry] of geometries.entries()) {
    const originalCellId = originalCellIds[geometryIndex]!;
    let remappedCellId: CellId | undefined;
    try {
      remappedCellId = index.uniqueMatch(geometry);
    } catch (error) {
      if (error instanceof RefinementCellGeometryMatchError) {
        throw historyConflict(
          `${label} geometry for ${originalCellId} is ambiguous`,
          [originalCellId, ...error.cellIds],
          historyCommandIds
        );
      }
      throw error;
    }
    if (remappedCellId === undefined) {
      throw historyConflict(
        `${label} geometry for ${originalCellId} has no active match`,
        [originalCellId],
        historyCommandIds
      );
    }
    remappedCellIds.push(remappedCellId);
  }
  if (new Set(remappedCellIds).size !== remappedCellIds.length) {
    throw historyConflict(
      `${label} geometry does not map one-to-one`,
      [...originalCellIds, ...remappedCellIds],
      historyCommandIds
    );
  }
  return remappedCellIds;
}

function sameCellIdSet(
  first: readonly CellId[],
  second: readonly CellId[]
): boolean {
  if (first.length !== second.length) {
    return false;
  }
  const secondIds = new Set(second);
  return first.every((cellId) => secondIds.has(cellId));
}

function rebaseRefinementSessionPatchPlan(
  session: RefinementSession,
  plan: RefinementSessionPatchPlanInternal,
  level: number,
  options: RefinementSessionPatchOptions,
  historyCommandIds: readonly string[]
): RefinementSessionPatchPlanInternal {
  const parentCellIds = replacementParentCellIds(
    plan.planningActive,
    plan.replacements
  );
  const sourceActive = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false,
    ...(options.mergeTolerance === undefined
      ? {}
      : { mergeTolerance: options.mergeTolerance })
  });
  const planningActive =
    buildSameLevelRefinementPlanningMesh(
      session,
      level,
      options
    );
  const replacements = plan.replacements.map(
    (replacement, index) => {
      const cellId = parentCellIds[index]!;
      const elementId = activeBuildElementIdByCellId(
        session,
        planningActive,
        cellId
      );
      if (elementId === undefined) {
        throw historyConflict(
          `prevalidated current parent ${cellId} is no longer active`,
          [cellId],
          historyCommandIds
        );
      }
      return {
        ...replacement,
        elementId
      };
    }
  );
  return finalizeRefinementSessionPatchPlan({
    ...plan,
    sourceActive,
    planningActive,
    replacements,
    sourceReplacements: mapPlanningReplacementsToSource(
      session,
      sourceActive,
      planningActive,
      replacements
    )
  });
}

function rebaseRefinementSessionPatchPlanFromState(
  state: RefinementSessionStateReader,
  plan: RefinementSessionPatchPlanInternal,
  level: number,
  options: RefinementSessionPatchOptions,
  historyCommandIds: readonly string[],
  scope?: HistoryPlanningScope
): RefinementSessionPatchPlanInternal {
  const parentCellIds = replacementParentCellIds(
    plan.planningActive,
    plan.replacements
  );
  const builds = scope === undefined ? undefined : historyPlanningBuilds(state, scope);
  const buildOptions: BuildActiveMeshOptions = {
      mergeNodes: true,
      includeSessionNodeIdByNodeId: false,
      includeSessionNodeIdsByNodeId: false,
      ...(options.mergeTolerance === undefined
        ? {}
        : { mergeTolerance: options.mergeTolerance })
    };
  const sourceActive = builds?.buildComplete(buildOptions)
    ?? buildActiveMeshWithMapFromSessionStateInternal(state, buildOptions);
  const planningActive = builds?.buildSameLevel(level, options)
    ?? buildSameLevelRefinementPlanningMeshFromState(
    state,
    level,
    options
  );
  const replacements = plan.replacements.map(
    (replacement, index) => {
      const cellId = parentCellIds[index]!;
      const elementId = activeBuildElementIdByCellIdFromState(
        state,
        planningActive,
        cellId,
        [cellId]
      );
      if (elementId === undefined) {
        throw historyConflict(
          `prevalidated current parent ${cellId} is no longer active`,
          [cellId],
          historyCommandIds
        );
      }
      return {
        ...replacement,
        elementId
      };
    }
  );
  return finalizeRefinementSessionPatchPlan({
    ...plan,
    sourceActive,
    planningActive,
    replacements,
    sourceReplacements: mapPlanningReplacementsToSourceState(
      state,
      sourceActive,
      planningActive,
      replacements,
      parentCellIds
    )
  });
}

function replaySessionPatchOptions(
  options: RefinementSessionCommandRecipeV1["options"],
  transitionSupportCellIds: readonly CellId[]
): RefinementSessionPatchOptions {
  return {
    includeTransitions: options.includeTransitions,
    hexRefinementRatio: options.hexRefinementRatio,
    hexTwoToOneSelectionMode:
      options.hexTwoToOneSelectionMode,
    hexTwoToOneCompensation: {
      mode: options.hexTwoToOneCompensation.mode,
      maxAddedParentLayers:
        options.hexTwoToOneCompensation.maxAddedParentLayers,
      maxAddedParentCount:
        options.hexTwoToOneCompensation.maxAddedParentCount
    },
    rebuildExistingTransitions:
      options.rebuildExistingTransitions,
    transitionSupportCellIds: [...transitionSupportCellIds],
    ...(options.mergeTolerance === undefined
      ? {}
      : { mergeTolerance: options.mergeTolerance })
  };
}

function assertHistoryReplayCommandEquivalent(
  historicalCommand: RefinementSessionCommand,
  replayedCommand: RefinementSessionCommand,
  remappedSelectedCellIds: readonly CellId[],
  remappedTransitionSupportCellIds: readonly CellId[],
  historyCommandId: string
): void {
  const historicalRecipe = historicalCommand.recipe;
  const replayedRecipe = replayedCommand.recipe;
  const recipeIsEquivalent =
    historicalRecipe !== undefined
    && replayedRecipe !== undefined
    && replayedRecipe.version === historicalRecipe.version
    && sameReplayRecipeOptions(
      historicalRecipe.options,
      replayedRecipe.options
    )
    && sameCellIdSet(
      replayedRecipe.selectedCellIds,
      remappedSelectedCellIds
    )
    && sameCellIdSet(
      replayedRecipe.transitionSupportCellIds,
      remappedTransitionSupportCellIds
    )
    && sameGeometrySnapshotStructures(
      historicalRecipe.selectedCellGeometry,
      replayedRecipe.selectedCellGeometry
    )
    && sameGeometrySnapshotStructures(
      historicalRecipe.transitionSupportCellGeometry,
      replayedRecipe.transitionSupportCellGeometry
    );
  if (
    replayedCommand.kind !== historicalCommand.kind
    || !recipeIsEquivalent
  ) {
    throw historyConflict(
      `history command ${historyCommandId} replay changed its refinement output`,
      historicalCommand.recipe?.selectedCellIds ?? [],
      [historyCommandId]
    );
  }
}

function sameReplayRecipeOptions(
  first: RefinementSessionCommandRecipeV1["options"],
  second: RefinementSessionCommandRecipeV1["options"]
): boolean {
  return first.includeTransitions === second.includeTransitions
    && first.hexRefinementRatio === second.hexRefinementRatio
    && first.hexTwoToOneSelectionMode
      === second.hexTwoToOneSelectionMode
    && first.rebuildExistingTransitions
      === second.rebuildExistingTransitions
    && Object.is(first.mergeTolerance, second.mergeTolerance)
    && first.hexTwoToOneCompensation.mode
      === second.hexTwoToOneCompensation.mode
    && first.hexTwoToOneCompensation.maxAddedParentLayers
      === second.hexTwoToOneCompensation.maxAddedParentLayers
    && first.hexTwoToOneCompensation.maxAddedParentCount
      === second.hexTwoToOneCompensation.maxAddedParentCount;
}

function sameGeometrySnapshotStructures(
  first: readonly RefinementCellGeometrySnapshot[],
  second: readonly RefinementCellGeometrySnapshot[]
): boolean {
  return sameSortedStrings(
    first.map(refinementGeometrySnapshotStructure),
    second.map(refinementGeometrySnapshotStructure)
  );
}

function refinementGeometrySnapshotStructure(
  geometry: RefinementCellGeometrySnapshot
): string {
  const points = geometry.points.map((point) =>
    point.map((coordinate) =>
      coordinate.toPrecision(17)
    ).join(",")
  ).sort();
  return JSON.stringify({
    kind: geometry.kind,
    level: geometry.level,
    role: geometry.role,
    points
  });
}

function sameSortedStrings(
  first: readonly string[],
  second: readonly string[]
): boolean {
  if (first.length !== second.length) {
    return false;
  }
  const firstSorted = [...first].sort();
  const secondSorted = [...second].sort();
  return firstSorted.every(
    (value, index) => value === secondSorted[index]
  );
}

function buildCompletedRebuiltSupportPlan(
  session: RefinementSession,
  initialCoreParentIds: readonly CellId[],
  authorizedCompletionParentIds: ReadonlySet<CellId>,
  historyCommandIds: readonly string[],
  options: RefinementSessionPatchOptions
): RefinementSessionPatchPlanInternal {
  const selectedCellIds = [...initialCoreParentIds].sort(compareCellIds);
  try {
    return buildRefinementSessionPatchPlan(session, selectedCellIds, options);
  } catch (error) {
    if (
      !(
        error instanceof DirectTwoToOnePlanningError
        && error.kind === "selection-signature"
      )
      && !(
        error instanceof TwoToOnePlanningError
        && error.code === "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY"
      )
    ) {
      throw error;
    }
  }
  const validation = validateRefinementSessionSelection(session, selectedCellIds);
  if (!validation.ok || validation.level === undefined) {
    throw new Error(validation.errors.join("; "));
  }
  const completedCellIds = completeLogicalSupportParentBlock(
    session,
    selectedCellIds,
    validation.level,
    authorizedCompletionParentIds,
    historyCommandIds,
    options
  );
  return buildRefinementSessionPatchPlan(session, completedCellIds, options);
}

function buildCompletedRebuiltSupportPlanFromState(
  state: RefinementSessionStateReader,
  initialCoreParentIds: readonly CellId[],
  authorizedCompletionParentIds: ReadonlySet<CellId>,
  historyCommandIds: readonly string[],
  options: RefinementSessionPatchOptions,
  scope?: HistoryPlanningScope
): RefinementSessionPatchPlanInternal {
  const selectedCellIds = [...initialCoreParentIds].sort(compareCellIds);
  try {
    return buildResolvedRefinementSessionPatchPlanFromStateInternal(
      state,
      selectedCellIds,
      options,
      scope
    );
  } catch (error) {
    if (
      !(
        error instanceof DirectTwoToOnePlanningError
        && error.kind === "selection-signature"
      )
      && !(
        error instanceof TwoToOnePlanningError
        && error.code === "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY"
      )
    ) {
      throw error;
    }
  }
  const validation = validateRefinementSessionStateSelection(
    state,
    selectedCellIds
  );
  if (!validation.ok || validation.level === undefined) {
    throw new Error(validation.errors.join("; "));
  }
  const completedCellIds = completeLogicalSupportParentBlockFromState(
    state,
    selectedCellIds,
    validation.level,
    authorizedCompletionParentIds,
    historyCommandIds,
    options,
    scope
  );
  return buildResolvedRefinementSessionPatchPlanFromStateInternal(
    state,
    completedCellIds,
    options,
    scope
  );
}

function completeLogicalSupportParentBlock(
  session: RefinementSession,
  parentIds: readonly CellId[],
  level: number,
  authorizedCellIds: ReadonlySet<CellId>,
  historyCommandIds: readonly string[],
  options: RefinementSessionPatchOptions
): CellId[] {
  const active = level > 0
    ? buildSameLevelRefinementPlanningMesh(session, level, options)
    : buildRefinementPatchActiveMesh(session, parentIds, options);
  const elementIds = parentIds.map((cellId) => {
    const elementId = activeBuildElementIdByCellId(session, active, cellId);
    if (elementId === undefined) {
      throw new Error(`supporting parent ${cellId} is outside the restored level-${level} mesh`);
    }
    return elementId;
  });
  const tolerance = options.mergeTolerance
    ?? minElementEdgeLength(active.mesh) * 0.000001;
  const lattice = inferHexElementLattice(mutableMeshView(active.mesh), tolerance);
  const indices = elementIds.map((elementId) => lattice.indicesByElementId.get(elementId));
  if (indices.some((value) => value === undefined)) {
    throw new Error("automatic transition-shell rebuilding requires a recoverable logical parent lattice");
  }
  const typedIndices = indices as Array<[number, number, number]>;
  const min = ([0, 1, 2] as const).map((axis) =>
    Math.min(...typedIndices.map((value) => value[axis]))
  ) as [number, number, number];
  const max = ([0, 1, 2] as const).map((axis) =>
    Math.max(...typedIndices.map((value) => value[axis]))
  ) as [number, number, number];
  const completedParentIds: CellId[] = [];
  for (let i = min[0]; i <= max[0]; i += 1) {
    for (let j = min[1]; j <= max[1]; j += 1) {
      for (let k = min[2]; k <= max[2]; k += 1) {
        const elementId = lattice.elementIdByKey.get(`${i}:${j}:${k}`);
        const cellId = elementId === undefined
          ? undefined
          : activeBuildCellIdByElementId(active, elementId);
        if (cellId === undefined) {
          throw new Error("automatic transition-shell rebuilding found a hole in the logical parent block");
        }
        const cell = requiredCell(session, cellId);
        if (!isRefinableSessionCell(cell) || cell.level !== level) {
          throw new Error(`logical support parent ${cellId} is not an active refinable level-${level} cell`);
        }
        if (!authorizedCellIds.has(cellId)) {
          throw historyConflict(
            `logical support completion would cross the authorized support component at ${cellId}`,
            [cellId],
            historyCommandIds
          );
        }
        completedParentIds.push(cellId);
      }
    }
  }
  return completedParentIds.sort(compareCellIds);
}

function completeLogicalSupportParentBlockFromState(
  state: RefinementSessionStateReader,
  parentIds: readonly CellId[],
  level: number,
  authorizedCellIds: ReadonlySet<CellId>,
  historyCommandIds: readonly string[],
  options: RefinementSessionPatchOptions,
  scope?: HistoryPlanningScope
): CellId[] {
  const active = (scope === undefined ? undefined : historyPlanningBuilds(state, scope).buildSameLevel(level, options))
    ?? buildSameLevelRefinementPlanningMeshFromState(
    state,
    level,
    options
  );
  const elementIds = parentIds.map((cellId) => {
    const elementId = activeBuildElementIdByCellIdFromState(
      state,
      active,
      cellId,
      parentIds
    );
    if (elementId === undefined) {
      throw new Error(
        `supporting parent ${cellId} is outside the restored level-${level} mesh`
      );
    }
    return elementId;
  });
  const tolerance = options.mergeTolerance
    ?? minElementEdgeLength(active.mesh) * 0.000001;
  const lattice = inferHexElementLattice(
    mutableMeshView(active.mesh),
    tolerance
  );
  const indices = elementIds.map((elementId) =>
    lattice.indicesByElementId.get(elementId)
  );
  if (indices.some((value) => value === undefined)) {
    throw new Error(
      "automatic transition-shell rebuilding requires a recoverable logical parent lattice"
    );
  }
  const typedIndices = indices as Array<[number, number, number]>;
  const min = ([0, 1, 2] as const).map((axis) =>
    Math.min(...typedIndices.map((value) => value[axis]))
  ) as [number, number, number];
  const max = ([0, 1, 2] as const).map((axis) =>
    Math.max(...typedIndices.map((value) => value[axis]))
  ) as [number, number, number];
  const completedParentIds: CellId[] = [];
  for (let i = min[0]; i <= max[0]; i += 1) {
    for (let j = min[1]; j <= max[1]; j += 1) {
      for (let k = min[2]; k <= max[2]; k += 1) {
        const elementId = lattice.elementIdByKey.get(`${i}:${j}:${k}`);
        const cellId = elementId === undefined
          ? undefined
          : activeBuildCellIdByElementId(active, elementId);
        if (cellId === undefined) {
          throw new Error(
            "automatic transition-shell rebuilding found a hole in the logical parent block"
          );
        }
        const cell = requiredSessionStateCell(state, cellId);
        if (!isRefinableSessionCell(cell) || cell.level !== level) {
          throw new Error(
            `logical support parent ${cellId} is not an active refinable level-${level} cell`
          );
        }
        if (!authorizedCellIds.has(cellId)) {
          throw historyConflict(
            `logical support completion would cross the authorized support component at ${cellId}`,
            [cellId],
            historyCommandIds
          );
        }
        completedParentIds.push(cellId);
      }
    }
  }
  return completedParentIds.sort(compareCellIds);
}

function collectAuthorizedCompletionParentIds(
  session: RefinementSession,
  originalSupportParentIds: readonly CellId[],
  supportCommands: readonly RefinementSessionCommand[],
  parentLevel: number,
  tolerance: number
): Set<CellId> {
  const authorized = new Set(originalSupportParentIds);
  const supportCreatedCellIds = new Set(
    supportCommands.flatMap((command) =>
      command.createdCellIds
    )
  );
  const boundaryFaces = createSessionFaceIndex(tolerance);
  for (const cellId of stableCellIds(originalSupportParentIds)) {
    for (const face of refinementCellFaces(session, requiredCell(session, cellId))) {
      boundaryFaces.add(face);
    }
  }
  for (const cellId of stableCellIds(session.activeLeafIds)) {
    if (authorized.has(cellId)) {
      continue;
    }
    const cell = requiredCell(session, cellId);
    if (
      cell.level !== parentLevel
      || !isRefinableSessionCell(cell)
      || !(
        cell.parentId === undefined
        || supportCreatedCellIds.has(cellId)
      )
    ) {
      continue;
    }
    let touchesBoundary = false;
    for (const face of refinementCellFaces(session, cell)) {
      if (boundaryFaces.uniqueMatch(face) !== undefined) {
        touchesBoundary = true;
      }
    }
    if (touchesBoundary) {
      authorized.add(cellId);
    }
  }
  return authorized;
}

function collectAuthorizedCompletionParentIdsFromState(
  state: RefinementSessionStateReader,
  originalSupportParentIds: readonly CellId[],
  supportCommands: readonly RefinementSessionCommand[],
  parentLevel: number,
  tolerance: number,
  scopedActiveIds?: readonly CellId[]
): Set<CellId> {
  const authorized = new Set(originalSupportParentIds);
  const supportCreatedCellIds = new Set(
    supportCommands.flatMap((command) => command.createdCellIds)
  );
  const boundaryFaces = createSessionFaceIndex(tolerance);
  for (const cellId of stableCellIds(originalSupportParentIds)) {
    for (const face of refinementCellFacesFromState(
      state,
      requiredSessionStateCell(state, cellId)
    )) {
      boundaryFaces.add(face);
    }
  }
  for (const cellId of scopedActiveIds ?? sortedActiveLeafIdsFromSessionState(state)) {
    if (authorized.has(cellId)) {
      continue;
    }
    const cell = requiredSessionStateCell(state, cellId);
    if (
      cell.level !== parentLevel
      || !isRefinableSessionCell(cell)
      || !(
        cell.parentId === undefined
        || supportCreatedCellIds.has(cellId)
      )
    ) {
      continue;
    }
    let touchesBoundary = false;
    for (const face of refinementCellFacesFromState(state, cell)) {
      if (boundaryFaces.uniqueMatch(face) !== undefined) {
        touchesBoundary = true;
      }
    }
    if (touchesBoundary) {
      authorized.add(cellId);
    }
  }
  return authorized;
}

function validateRebuiltSupportPlanOwnership(
  session: RefinementSession,
  replacementParentIds: readonly CellId[],
  originalSupportParentIds: readonly CellId[],
  supportCommands: readonly RefinementSessionCommand[],
  tolerance: number
): void {
  const originalSupport = new Set(originalSupportParentIds);
  const supportCreated = new Set(
    supportCommands.flatMap((command) =>
      command.createdCellIds
    )
  );
  const supportCommandIds = supportCommands.map(
    (command) => command.id
  );
  const replacementInterfaces = createSessionFaceIndex(tolerance);
  for (const cellId of stableCellIds(replacementParentIds)) {
    const cell = requiredCell(session, cellId);
    for (const face of refinementCellFaces(session, cell)) {
      replacementInterfaces.uniqueMatch(face);
      replacementInterfaces.add(face);
    }
    if (
      originalSupport.has(cellId)
      || cell.parentId === undefined
      || supportCreated.has(cellId)
    ) {
      continue;
    }
    throw historyConflict(
      `automatic transition-shell rebuilding would cross refinement-command provenance at ${cellId}`,
      [cellId],
      supportCommandIds
    );
  }
}

function findCollidingTransitionParentIds(
  session: RefinementSession,
  selectedCellIds: readonly CellId[],
  supportLayerCellIds: readonly CellId[],
  level: number,
  options: RefinementSessionPatchOptions,
  tolerance: number
): CellId[] {
  const planningActive = buildSameLevelRefinementPlanningMesh(session, level, options);
  const selectedElementIds = selectedCellIds.map((cellId) => {
    const elementId = activeBuildElementIdByCellId(session, planningActive, cellId);
    if (elementId === undefined) {
      throw new Error(`selected cell ${cellId} is outside the level-${level} collision-planning mesh`);
    }
    return elementId;
  });
  const replacements = buildDefaultRefinementPlan(
    mutableMeshView(planningActive.mesh),
    selectedElementIds,
    {
      includeTransitions: options.includeTransitions ?? true,
      hexRefinementRatio: 2,
      ...(options.hexTwoToOneCompensation === undefined
        ? {}
        : {
            hexTwoToOneCompensation:
              options.hexTwoToOneCompensation
          }),
      transitionSupportElementIds: (options.transitionSupportCellIds ?? [])
        .map((cellId) => activeBuildElementIdByCellId(session, planningActive, cellId))
        .filter((elementId): elementId is number => elementId !== undefined),
      regularizeHexSelection: false,
      ...(options.mergeTolerance !== undefined ? { mergeTolerance: options.mergeTolerance } : {})
    }
  ).replacements;
  const replacementFaces = createSessionFaceIndex(tolerance);
  for (const replacement of replacements) {
    const cellId = activeBuildCellIdByElementId(planningActive, replacement.elementId);
    if (cellId === undefined) {
      continue;
    }
    for (const face of refinementCellFaces(session, requiredCell(session, cellId))) {
      replacementFaces.add(face);
    }
  }
  const collidingParentIds = new Set<CellId>();
  for (const cellId of stableCellIds(supportLayerCellIds)) {
    const cell = requiredCell(session, cellId);
    if (!isTransitionSessionCell(cell)) {
      continue;
    }
    let collides = false;
    for (const face of refinementCellFaces(session, cell)) {
      if (replacementFaces.uniqueMatch(face) !== undefined) {
        collides = true;
      }
    }
    if (collides && cell.parentId !== undefined) {
      collidingParentIds.add(cell.parentId);
    }
  }
  return [...collidingParentIds].sort(compareCellIds);
}

function findCollidingTransitionParentIdsFromState(
  state: RefinementSessionStateReader,
  selectedCellIds: readonly CellId[],
  supportLayerCellIds: readonly CellId[],
  level: number,
  options: RefinementSessionPatchOptions,
  tolerance: number
): CellId[] {
  const planningActive = buildSameLevelRefinementPlanningMeshFromState(
    state,
    level,
    options,
    stableCellIds([...supportLayerCellIds, ...selectedCellIds])
      .filter((id) => state.hasActiveLeaf(id))
  );
  const selectedElementIds = selectedCellIds.map((cellId) => {
    const elementId = activeBuildElementIdByCellIdFromState(
      state,
      planningActive,
      cellId,
      selectedCellIds
    );
    if (elementId === undefined) {
      throw new Error(
        `selected cell ${cellId} is outside the level-${level} collision-planning mesh`
      );
    }
    return elementId;
  });
  const replacements = buildDefaultRefinementPlan(
    mutableMeshView(planningActive.mesh),
    selectedElementIds,
    {
      includeTransitions: options.includeTransitions ?? true,
      hexRefinementRatio: 2,
      ...(options.hexTwoToOneCompensation === undefined
        ? {}
        : {
            hexTwoToOneCompensation:
              options.hexTwoToOneCompensation
          }),
      transitionSupportElementIds: (options.transitionSupportCellIds ?? [])
        .map((cellId) => activeBuildElementIdByCellIdFromState(
          state,
          planningActive,
          cellId,
          selectedCellIds
        ))
        .filter((elementId): elementId is number => elementId !== undefined),
      regularizeHexSelection: false,
      ...(options.mergeTolerance === undefined
        ? {}
        : { mergeTolerance: options.mergeTolerance })
    }
  ).replacements;
  const replacementFaces = createSessionFaceIndex(tolerance);
  for (const replacement of replacements) {
    const cellId = activeBuildCellIdByElementId(
      planningActive,
      replacement.elementId
    );
    if (cellId === undefined) {
      continue;
    }
    for (const face of refinementCellFacesFromState(
      state,
      requiredSessionStateCell(state, cellId)
    )) {
      replacementFaces.add(face);
    }
  }
  const collidingParentIds = new Set<CellId>();
  for (const cellId of stableCellIds(supportLayerCellIds)) {
    const cell = requiredSessionStateCell(state, cellId);
    if (!isTransitionSessionCell(cell)) {
      continue;
    }
    let collides = false;
    for (const face of refinementCellFacesFromState(state, cell)) {
      if (replacementFaces.uniqueMatch(face) !== undefined) {
        collides = true;
      }
    }
    if (collides && cell.parentId !== undefined) {
      collidingParentIds.add(cell.parentId);
    }
  }
  return [...collidingParentIds].sort(compareCellIds);
}

function collectConnectedSupportLayerCells(
  session: RefinementSession,
  supportCellIds: readonly CellId[],
  selectedCellIds: readonly CellId[],
  tolerance: number
): CellId[] {
  const supportSet = new Set(supportCellIds);
  const selectedSupportCellIds = selectedCellIds.filter((cellId) => supportSet.has(cellId));
  if (selectedSupportCellIds.length !== selectedCellIds.length) {
    throw new Error("automatic transition-shell rebuilding selection is outside its supporting layer");
  }
  const adjacency = new Map<CellId, Set<CellId>>();
  const index = createSessionFaceIndex(tolerance);
  for (const cellId of stableCellIds(supportCellIds)) {
    adjacency.set(cellId, new Set<CellId>());
    const cell = requiredCell(session, cellId);
    for (const face of refinementCellFaces(session, cell)) {
      const match = index.uniqueMatch(face);
      if (match !== undefined && match.owner !== cellId) {
        adjacency.get(cellId)!.add(match.owner);
        adjacency.get(match.owner)!.add(cellId);
      }
      index.add(face);
    }
  }

  const component = new Set<CellId>();
  const queue = [selectedSupportCellIds[0]!];
  while (queue.length > 0) {
    const cellId = queue.pop()!;
    if (component.has(cellId)) {
      continue;
    }
    component.add(cellId);
    for (const neighborId of adjacency.get(cellId) ?? []) {
      if (!component.has(neighborId)) {
        queue.push(neighborId);
      }
    }
  }
  const outsideSelectedCellIds = selectedSupportCellIds.filter((cellId) => !component.has(cellId));
  if (outsideSelectedCellIds.length > 0) {
    throw new Error(
      "automatic transition-shell rebuilding requires selected cells from one connected support component"
    );
  }
  return [...component].sort(compareCellIds);
}

function collectConnectedSupportLayerCellsFromState(
  state: RefinementSessionStateReader,
  supportCellIds: readonly CellId[],
  selectedCellIds: readonly CellId[],
  tolerance: number
): CellId[] {
  const supportSet = new Set(supportCellIds);
  const selectedSupportCellIds = selectedCellIds.filter((cellId) =>
    supportSet.has(cellId)
  );
  if (selectedSupportCellIds.length !== selectedCellIds.length) {
    throw new Error(
      "automatic transition-shell rebuilding selection is outside its supporting layer"
    );
  }
  const adjacency = new Map<CellId, Set<CellId>>();
  const index = createSessionFaceIndex(tolerance);
  for (const cellId of stableCellIds(supportCellIds)) {
    adjacency.set(cellId, new Set<CellId>());
    const cell = requiredSessionStateCell(state, cellId);
    for (const face of refinementCellFacesFromState(state, cell)) {
      const match = index.uniqueMatch(face);
      if (match !== undefined && match.owner !== cellId) {
        adjacency.get(cellId)!.add(match.owner);
        adjacency.get(match.owner)!.add(cellId);
      }
      index.add(face);
    }
  }
  const component = new Set<CellId>();
  const queue = [selectedSupportCellIds[0]!];
  while (queue.length > 0) {
    const cellId = queue.pop()!;
    if (component.has(cellId)) {
      continue;
    }
    component.add(cellId);
    for (const neighborId of adjacency.get(cellId) ?? []) {
      if (!component.has(neighborId)) {
        queue.push(neighborId);
      }
    }
  }
  const outsideSelectedCellIds = selectedSupportCellIds.filter(
    (cellId) => !component.has(cellId)
  );
  if (outsideSelectedCellIds.length > 0) {
    throw new Error(
      "automatic transition-shell rebuilding requires selected cells from one connected support component"
    );
  }
  return [...component].sort(compareCellIds);
}

function resolveSessionFaceResolution(
  session: RefinementSession,
  cellIds: readonly CellId[],
  diagnosticCellIds: readonly CellId[],
  options: RefinementSessionPatchOptions
): SessionFaceResolution {
  assertValidSessionFaceTolerance(options.mergeTolerance);
  let geometryResolution: ActiveMeshGeometryResolution;
  let mergeTolerance = options.mergeTolerance;
  if (options.activeBuild !== undefined) {
    assertActiveBuildCoversSessionCells(
      session,
      options.activeBuild,
      diagnosticCellIds
    );
    const recordedTolerance = options.activeBuild.mergeTolerance;
    if (recordedTolerance === undefined) {
      throw sessionFaceResolutionError(
        diagnosticCellIds,
        "external activeBuild does not record a merge tolerance, so transition face tolerance consistency cannot be proven"
      );
    }
    if (
      options.mergeTolerance !== undefined
      && options.mergeTolerance !== recordedTolerance
    ) {
      throw sessionFaceResolutionError(
        diagnosticCellIds,
        `external activeBuild merge tolerance ${recordedTolerance} does not match requested merge tolerance ${options.mergeTolerance}`
      );
    }
    const recordedResolution = options.activeBuild.geometryResolution;
    if (recordedResolution === undefined) {
      throw sessionFaceResolutionError(
        diagnosticCellIds,
        "external activeBuild does not expose a geometry resolution for transition face matching"
      );
    }
    geometryResolution = recordedResolution;
    mergeTolerance = recordedTolerance;
  } else {
    const build = buildActiveMeshForCellIdsWithMap(
      session,
      cellIds,
      {},
      undefined,
      false
    );
    geometryResolution = build.geometryResolution
      ?? measureActiveMeshGeometryResolution(build.mesh);
  }
  const tolerance = effectiveSessionFaceTolerance(
    geometryResolution.minimumElementEdgeLength,
    geometryResolution.coordinateScale,
    mergeTolerance
  );
  assertSessionFaceGeometryResolution(
    diagnosticCellIds,
    tolerance,
    geometryResolution.minimumElementEdgeLength,
    cellIds.length > 0
  );
  return {
    tolerance,
    minimumElementEdgeLength: geometryResolution.minimumElementEdgeLength,
    coordinateScale: geometryResolution.coordinateScale,
    ...(mergeTolerance === undefined ? {} : { mergeTolerance })
  };
}

function effectiveSessionFaceTolerance(
  edge: number,
  scale: number,
  requested?: number
): number {
  const edgeTolerance = Number.isFinite(edge) && edge >= 0
    ? edge * 1e-8
    : 0;
  return Math.max(
    requested ?? 0,
    Number.isFinite(edgeTolerance) ? edgeTolerance : 0,
    scale * Number.EPSILON * 64
  );
}

interface ValidatedActiveBuildSession {
  readonly mappings: TrustedActiveMeshMappings;
  readonly sessionGuard: TrustedSessionBuildGuard;
}

export function validateActiveBuildForSession(
  session: RefinementSession,
  build: ActiveMeshBuildResult
): ActiveMeshBuildResult {
  validateActiveBuildSession(session, build, []);
  return build;
}

/**
 * Validates reusable-build provenance once, then rechecks the named cells in
 * O(cellIds), including active mapping, metadata, connectivity, and geometry.
 */
export function validateActiveBuildCellsForSession(
  session: RefinementSession,
  build: ActiveMeshBuildResult,
  cellIds: readonly CellId[]
): ActiveMeshBuildResult {
  const validated = validateActiveBuildSession(session, build, cellIds);
  for (const cellId of cellIds) {
    validateActiveBuildCellForSession(
      session,
      validated,
      cellId,
      cellIds,
      false
    );
  }
  return build;
}

function validateActiveBuildSession(
  session: RefinementSession,
  build: ActiveMeshBuildResult,
  diagnosticCellIds: readonly CellId[]
): ValidatedActiveBuildSession {
  if (mappingOnlyActiveMeshBuilds.has(build)) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      "mapping-only session-state activeBuild cannot be validated for a concrete session"
    );
  }
  const token = refinementSessionToken(session);
  const mappings = ensureTrustedActiveMeshMappings(build, diagnosticCellIds);
  const internalTrust = internalActiveMeshBuildTrust.get(build);
  let sessionGuard: TrustedSessionBuildGuard;
  if (internalTrust !== undefined) {
    if (
      internalTrust.sessionToken !== token
      || internalTrust.sessionRevision !== session.revision
    ) {
      throw sessionFaceResolutionError(
        diagnosticCellIds,
        "internal activeBuild is stale because the session revision changed"
      );
    }
    sessionGuard = internalTrust.sessionGuard;
  } else {
    const provenance = activeBuildProvenanceForValidation(build, diagnosticCellIds);
    const trusted = activeMeshBuildTrust.get(build);
    if (trusted !== undefined && trusted.sessionToken === token) {
      if (trusted.sessionRevision !== session.revision) {
        throw sessionFaceResolutionError(
          diagnosticCellIds,
          "external activeBuild is stale because the session revision changed"
        );
      }
      if (
        trusted.mesh !== build.mesh
        || trusted.geometryResolution !== build.geometryResolution
        || trusted.provenance !== provenance
        || !Object.is(trusted.mergeTolerance, build.mergeTolerance)
      ) {
        throw sessionFaceResolutionError(
          diagnosticCellIds,
          "external activeBuild metadata or mappings were tampered with"
        );
      }
      sessionGuard = trusted.sessionGuard;
    } else {
      let sessionFingerprint: string;
      try {
        sessionFingerprint = refinementSessionFingerprint(session);
      } catch (error) {
        throw sessionFaceResolutionError(
          diagnosticCellIds,
          error instanceof Error
            ? `external activeBuild validation failed: ${error.message}`
            : "external activeBuild validation failed"
        );
      }
      if (
        provenance.sessionRevision !== session.revision
        || provenance.sessionFingerprint !== sessionFingerprint
      ) {
        throw sessionFaceResolutionError(
          diagnosticCellIds,
          "external activeBuild is stale because the session geometry, connectivity, active leaves, or metadata changed"
        );
      }
      sessionGuard = createTrustedSessionBuildGuardFromMappings(session, mappings);
      activeMeshBuildTrust.set(build, Object.freeze({
        sessionToken: token,
        sessionRevision: session.revision,
        mesh: build.mesh,
        geometryResolution: build.geometryResolution!,
        provenance,
        mappings,
        sessionGuard,
        ...(build.mergeTolerance === undefined ? {} : { mergeTolerance: build.mergeTolerance })
      }));
    }
  }
  if (
    sessionGuard.nodes !== session.nodes
    || sessionGuard.cells !== session.cells
    || sessionGuard.activeLeafIds !== session.activeLeafIds
    || sessionGuard.nodeCount !== session.nodes.length
    || sessionGuard.cellCount !== session.cells.size
    || sessionGuard.activeLeafCount !== session.activeLeafIds.size
  ) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      "external activeBuild is stale because a session collection changed"
    );
  }
  return { mappings, sessionGuard };
}

function validateActiveBuildCellForSession(
  session: RefinementSession,
  validated: ValidatedActiveBuildSession,
  cellId: CellId,
  diagnosticCellIds: readonly CellId[],
  allowMissingInactive: boolean
): number | undefined {
  const { mappings, sessionGuard } = validated;
  const cell = session.cells.get(cellId);
  if (cell === undefined) {
    if (!allowMissingInactive || mappings.elementIdByCellId.has(cellId)) {
      throw sessionFaceResolutionError(
        diagnosticCellIds,
        `external activeBuild is stale because cell ${cellId} no longer exists`
      );
    }
    return undefined;
  }
  if (!isValidCellOrdinal(cell.ordinal)) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      `external activeBuild is stale because cell ${cellId} has invalid ordinal ${cell.ordinal}`
    );
  }
  const elementId = trustedOptionalElementIdByCellId(session, mappings, cellId);
  const isActiveLeaf =
    cell.active && !cell.hidden && session.activeLeafIds.has(cellId);
  if ((elementId !== undefined) !== isActiveLeaf) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      `external activeBuild is stale because cell ${cellId} active-leaf state changed`
    );
  }
  if (elementId === undefined) {
    return undefined;
  }
  const expectedFingerprint = sessionGuard.cellFingerprintByElementId[elementId];
  let currentFingerprint: string;
  try {
    currentFingerprint = refinementSessionCellFingerprint(session, cellId, cell);
  } catch (error) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      error instanceof Error
        ? `external activeBuild cell validation failed: ${error.message}`
        : `external activeBuild cell ${cellId} validation failed`
    );
  }
  if (expectedFingerprint === undefined || expectedFingerprint !== currentFingerprint) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      `external activeBuild is stale because selected cell ${cellId} changed`
    );
  }
  return elementId;
}

function assertActiveBuildCoversSessionCells(
  session: RefinementSession,
  build: ActiveMeshBuildResult,
  diagnosticCellIds: readonly CellId[]
): void {
  const validated =
    validateActiveBuildSession(session, build, diagnosticCellIds);
  for (const cellId of diagnosticCellIds) {
    const elementId = validateActiveBuildCellForSession(
      session,
      validated,
      cellId,
      diagnosticCellIds,
      false
    );
    if (elementId === undefined) {
      throw sessionFaceResolutionError(
        diagnosticCellIds,
        `external activeBuild is stale because cell ${cellId} has an invalid ordinal or no longer maps to its expected element`
      );
    }
  }
}

function assertSessionFaceGeometryResolution(
  diagnosticCellIds: readonly CellId[],
  tolerance: number,
  minimumEdge: number,
  hasElements: boolean
): void {
  if (!hasElements) {
    return;
  }
  if (
    !Number.isFinite(minimumEdge)
    || minimumEdge <= 0
    || tolerance >= minimumEdge / 2
  ) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      `effective face tolerance ${tolerance} reaches the minimum edge ${minimumEdge} resolution limit; distinct vertex neighborhoods would overlap`
    );
  }
}

function historyConflict(
  message: string,
  conflictingCellIds: readonly CellId[],
  historyCommandIds: readonly string[] = []
): TwoToOnePlanningError<CellId> {
  return new TwoToOnePlanningError(
    "TWO_TO_ONE_HISTORY_CONFLICT",
    message,
    {
      conflictingCellIds: stableCellIds(conflictingCellIds),
      conflictingInterfaces: [],
      attemptedActions: [],
      historyCommandIds: [...new Set(historyCommandIds)].sort(),
      suggestion: {
        kind: "reduce-level"
      }
    }
  );
}

function compensationLimitError(
  selectedCellIds: readonly CellId[],
  action: TwoToOneCompensationAction<CellId>,
  compensation: NormalizedTwoToOneCompensation
): TwoToOnePlanningError<CellId> {
  return new TwoToOnePlanningError(
    "TWO_TO_ONE_COMPENSATION_LIMIT",
    `transition-shell compensation exceeds parent limits `
      + `(layers ${compensation.maxAddedParentLayers}, `
      + `parents ${compensation.maxAddedParentCount})`,
    {
      conflictingCellIds: stableCellIds(selectedCellIds),
      conflictingInterfaces: [],
      attemptedActions: [action],
      suggestion: {
        kind: "expand-selection",
        parentCellIds: [...action.addedParentCellIds]
      }
    }
  );
}

function sessionFaceResolutionError(
  cellIds: readonly CellId[],
  message: string
): TwoToOnePlanningError<CellId> {
  return freezeTwoToOnePlanningErrorDiagnostic(
    new TwoToOnePlanningError<CellId>(
      "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY",
      message,
      {
        conflictingCellIds: stableCellIds(cellIds),
        conflictingInterfaces: [],
        attemptedActions: [],
        suggestion: {
          kind: "remesh-source"
        }
      }
    )
  );
}

function assertValidSessionFaceTolerance(requested?: number): void {
  if (
    requested !== undefined
    && (!Number.isFinite(requested) || requested < 0)
  ) {
    throw new RangeError("mergeTolerance must be finite and nonnegative");
  }
}

function createSessionFaceIndex(
  tolerance: number
): GeometricFaceIndex<CellId> {
  return new GeometricFaceIndex<CellId>(tolerance, {
    allowNonPlanarExactCoordinateMatches: true
  });
}

function refinementCellFaces(
  session: RefinementSession,
  cell: RefinementSessionCell
): Array<GeometricFace<CellId>> {
  if (cell.kind !== "H1" || cell.element.length !== 8) {
    throw new Error(`cell ${cell.id} has invalid Hex connectivity`);
  }
  return H1_FACES.map((face) => {
    const nodeIds = face.map((localNodeId) => {
      const nodeId = cell.element[localNodeId - 1];
      if (nodeId === undefined || session.nodes[nodeId - 1] === undefined) {
        throw new Error(`cell ${cell.id} has an invalid Hex face`);
      }
      return nodeId;
    });
    return {
      owner: cell.id,
      nodeIds,
      points: nodeIds.map((nodeId) => session.nodes[nodeId - 1]!)
    };
  });
}

function findSupportCommands(
  session: RefinementSession,
  cellIds: readonly CellId[]
): RefinementSessionCommand[] {
  const commands = new Set<RefinementSessionCommand>();
  for (const cellId of cellIds) {
    const command = [...session.undoStack]
      .reverse()
      .find((candidate) => candidate.createdCellIds.includes(cellId));
    if (!command) {
      throw historyConflict(
        `automatic transition-shell rebuilding cannot trace cell ${cellId} to a refinement command`,
        [cellId]
      );
    }
    commands.add(command);
  }
  return session.undoStack.filter((command) =>
    commands.has(command)
  );
}

function historyCommandIdsForHiddenCells(
  session: RefinementSession,
  cellIds: readonly CellId[]
): string[] {
  const conflictingCellIds = new Set(cellIds);
  return session.undoStack
    .filter((command) => command.hiddenCellIds.some(
      (cellId) => conflictingCellIds.has(cellId)
    ))
    .map((command) => command.id);
}

function refinementCellGeometryKey(
  session: RefinementSession,
  cell: RefinementSessionCell
): string {
  return cell.element
    .map((nodeId) => {
      const point = session.nodes[nodeId - 1];
      if (!point) {
        throw new Error(`cell ${cell.id} references missing node ${nodeId}`);
      }
      return point.map((coordinate) => coordinate.toPrecision(17)).join(",");
    })
    .sort()
    .join("|");
}

function refinementCellGeometryKeyFromState(
  state: Pick<RefinementSessionStateReader, "node" | "nodeCount">,
  cell: RefinementSessionCell
): string {
  return cell.element
    .map((nodeId) =>
      activeSessionStateNode(state, nodeId, cell.id)
        .map((coordinate) => coordinate.toPrecision(17))
        .join(",")
    )
    .sort()
    .join("|");
}

export function cloneRefinementSessionCommand(
  command: RefinementSessionCommand
): RefinementSessionCommand {
  return freezeRefinementSessionCommand({
    ...command,
    hiddenCellIds: [...command.hiddenCellIds],
    createdCellIds: [...command.createdCellIds],
    ...(command.activeCreatedCellIds
      ? { activeCreatedCellIds: [...command.activeCreatedCellIds] }
      : {}),
    ...(command.reactivatedCellIds
      ? { reactivatedCellIds: [...command.reactivatedCellIds] }
      : {}),
    createdNodeIds: [...command.createdNodeIds],
    ...(command.twoToOne
      ? { twoToOne: cloneTwoToOneCapabilityReport(command.twoToOne) }
      : {})
  });
}

function freezeRefinementSessionCommand(
  command: RefinementSessionCommand
): RefinementSessionCommand {
  const quality = command.quality === undefined
    ? undefined
    : Object.freeze({ ...command.quality });
  const twoToOne = command.twoToOne === undefined
    ? undefined
    : freezeRefinementSessionCapabilityReport(command.twoToOne);
  const recipe = command.recipe === undefined
    ? undefined
    : freezeRefinementSessionCommandRecipe(command.recipe);
  return Object.freeze({
    id: command.id,
    kind: command.kind,
    hiddenCellIds: Object.freeze([...command.hiddenCellIds]),
    createdCellIds: Object.freeze([...command.createdCellIds]),
    ...(command.activeCreatedCellIds === undefined
      ? {}
      : { activeCreatedCellIds: Object.freeze([...command.activeCreatedCellIds]) }),
    ...(command.reactivatedCellIds === undefined
      ? {}
      : { reactivatedCellIds: Object.freeze([...command.reactivatedCellIds]) }),
    createdNodeIds: Object.freeze([...command.createdNodeIds]),
    ...(quality === undefined ? {} : { quality }),
    ...(twoToOne === undefined ? {} : { twoToOne }),
    ...(recipe === undefined ? {} : { recipe })
  });
}

function freezeRefinementSessionCapabilityReport(
  report: ReadonlyTwoToOneCapabilityReport<CellId>
): ReadonlyTwoToOneCapabilityReport<CellId> {
  const cloned = cloneTwoToOneCapabilityReport(report);
  for (const action of cloned.actions) {
    Object.freeze(action.addedParentCellIds);
    Object.freeze(action.replacedTransitionCellIds);
    Object.freeze(action);
  }
  Object.freeze(cloned.originalSelectedCellIds);
  Object.freeze(cloned.effectiveSelectedCellIds);
  Object.freeze(cloned.actions);
  Object.freeze(cloned.affectedComponentCellIds);
  return Object.freeze(cloned);
}

export function previewSessionPatch(
  session: RefinementSession,
  cellIds: CellId[],
  options: RefinementSessionPatchOptions = {}
): RefinementPreview<CellId> {
  const resolvedOptions = resolveSessionPatchOptions(session, cellIds, options);
  const sourceActive = resolvedOptions.activeBuild;
  try {
    let patch: RefinementSessionPatchPlanInternal;
    try {
      patch = buildRefinementSessionPatchPlan(session, cellIds, resolvedOptions);
    } catch (error) {
      const faceResolution = resolveExistingTransitionShellRebuild(
        session,
        cellIds,
        resolvedOptions,
        error
      );
      if (faceResolution !== undefined) {
        const transaction =
          planRefinementSessionHistoryTransaction(
            session,
            cellIds,
            resolvedOptions,
            faceResolution
          );
        return cloneRefinementPreview(
          transaction.preview
        );
      }
      throw error;
    }
    const replacedIds = new Set(
      patch.sourceReplacements.map((replacement) => replacement.elementId)
    );
    const plan = patch.sourceReplacements
      .map((replacement) => ({
        parentElementId: replacement.elementId,
        role: replacement.role,
        templateCode: replacement.templateCode,
        outputElementCount: replacement.refinement.elements.length
      }))
      .sort((first, second) =>
        first.parentElementId - second.parentElementId
        || first.templateCode - second.templateCode
      );
    const countRole = (role: RefinementRole): number =>
      plan.filter((item) => item.role === role).length;
    const unchangedElementCount =
      sourceActive.mesh.elements.length - replacedIds.size;
    return {
      kind: session.kind,
      planMode: "per-parent",
      plan,
      summary: {
        selectedElementCount: countRole("selected"),
        faceTransitionElementCount: countRole("face-transition"),
        edgeTransitionElementCount: countRole("edge-transition"),
        cornerTransitionElementCount: countRole("corner-transition"),
        unchangedElementCount,
        estimatedOutputElementCount: unchangedElementCount
          + plan.reduce((total, item) => total + item.outputElementCount, 0)
      },
      ...(patch.quality ? { quality: patch.quality } : {}),
      ...(patch.twoToOne
        ? {
            twoToOne: cloneTwoToOneCapabilityReport(patch.twoToOne)
          }
        : {})
    };
  } catch (error) {
    throw asTwoToOneSessionPlanningError(error, cellIds, sourceActive);
  }
}

function cloneRefinementPreview(
  preview: RefinementPreview<CellId>
): RefinementPreview<CellId> {
  if (preview.planMode === "aggregate") {
    return {
      kind: preview.kind,
      planMode: "aggregate",
      plan: [],
      summary: { ...preview.summary },
      compound: { ...preview.compound },
      twoToOne:
        cloneTwoToOneCapabilityReport(preview.twoToOne),
      ...(preview.quality === undefined
        ? {}
        : { quality: { ...preview.quality } }),
      ...(preview.regularization === undefined
        ? {}
        : {
            regularization:
              structuredClone(preview.regularization)
          })
    };
  }
  return {
    kind: preview.kind,
    planMode: "per-parent",
    plan: preview.plan.map((item) => ({ ...item })),
    summary: { ...preview.summary },
    ...(preview.quality === undefined
      ? {}
      : { quality: { ...preview.quality } }),
    ...(preview.regularization === undefined
      ? {}
      : {
          regularization:
            structuredClone(preview.regularization)
        }),
    ...(preview.twoToOne === undefined
      ? {}
      : {
          twoToOne:
            cloneTwoToOneCapabilityReport(preview.twoToOne)
        })
  };
}

/** @internal Builds a reusable patch plan without applying it. */
export function buildRefinementSessionPatchPlanInternal(
  session: RefinementSession,
  cellIds: CellId[],
  options: RefinementSessionPatchOptions = {}
): RefinementSessionPatchPlanInternal {
  return buildRefinementSessionPatchPlan(
    session,
    cellIds,
    resolveSessionPatchOptions(session, cellIds, options)
  );
}

/** @internal Builds a patch plan from one immutable session-state snapshot. */
export function buildRefinementSessionPatchPlanFromStateInternal(
  state: RefinementSessionStateReader,
  cellIds: CellId[],
  options: RefinementSessionPatchOptions = {}
): RefinementSessionPatchPlanInternal {
  assertRefinementSessionStateReferencePublisherInternal(state);
  const staged = stageRefinementSessionPlanningReferences(state);
  const plan = buildRefinementSessionPatchPlanFromState(
    staged.reader,
    cellIds,
    resolveSessionStatePatchOptions(staged.reader, cellIds, options)
  );
  staged.commit();
  return plan;
}

function buildResolvedRefinementSessionPatchPlanFromStateInternal(
  state: RefinementSessionStateReader,
  cellIds: CellId[],
  options: RefinementSessionPatchOptions,
  scope?: HistoryPlanningScope
): RefinementSessionPatchPlanInternal {
  assertRefinementSessionStateReferencePublisherInternal(state);
  const staged = stageRefinementSessionPlanningReferences(state);
  const plan = buildRefinementSessionPatchPlanFromState(
    staged.reader,
    cellIds,
    options,
    scope === undefined ? undefined : historyPlanningBuilds(staged.reader, scope)
  );
  staged.commit();
  return plan;
}

function snapshotPlanningArray<T>(value: unknown, label: string): T[] {
  return refinementSessionStateOrdinaryArraySnapshotInternal(
    value,
    label
  ) as T[];
}

function planningArrayLength(value: unknown, label: string): number {
  return refinementSessionStateOrdinaryArrayLengthInternal(value, label);
}

function planningArrayValue<T>(
  value: unknown,
  index: number,
  label: string
): T {
  return refinementSessionStateOrdinaryArrayValueInternal(
    value,
    index,
    label
  ) as T;
}

function snapshotPlanningArrayOrSet<T>(value: unknown, label: string): T[] {
  if (TRUSTED_ARRAY_IS_ARRAY(value)) {
    return snapshotPlanningArray<T>(value, label);
  }
  if (
    value === null
    || typeof value !== "object"
    || TRUSTED_REFLECT_APPLY(
      TRUSTED_OBJECT_GET_PROTOTYPE_OF,
      undefined,
      [value]
    ) !== TRUSTED_SET_PROTOTYPE
  ) {
    throw new TypeError(
      `refinement session state ${label} must be an ordinary Array or Set`
    );
  }
  return refinementSessionStateSetValuesInternal(value as Set<T>);
}

function planningMapGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  return TRUSTED_REFLECT_APPLY(TRUSTED_MAP_GET, map, [key]) as V | undefined;
}

function planningMapHas<K, V>(map: Map<K, V>, key: K): boolean {
  return TRUSTED_REFLECT_APPLY(TRUSTED_MAP_HAS, map, [key]) as boolean;
}

function planningMapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  TRUSTED_REFLECT_APPLY(TRUSTED_MAP_SET, map, [key, value]);
}

interface StagedRefinementSessionPlanningReferences {
  readonly reader: RefinementSessionStateReader;
  commit(): void;
}

function stageRefinementSessionPlanningReferences(
  state: RefinementSessionStateReader
): StagedRefinementSessionPlanningReferences {
  interface ObservedCell {
    readonly snapshot: RefinementSessionCell;
    readonly fingerprint: string;
    readonly identity: RefinementSessionCell;
  }
  interface ObservedNode {
    readonly snapshot: Point;
    readonly fingerprint: string;
    readonly identity: Point;
  }
  interface ObservedOwners {
    readonly snapshot: readonly CellId[];
    readonly identity: readonly CellId[];
  }
  const snapshotCell = (
    cell: RefinementSessionCell
  ): RefinementSessionCell => TRUSTED_OBJECT_FREEZE({
      id: cell.id,
      ordinal: cell.ordinal,
      ...(cell.parentId === undefined ? {} : { parentId: cell.parentId }),
      level: cell.level,
      role: cell.role,
      kind: cell.kind,
      element: TRUSTED_OBJECT_FREEZE(snapshotPlanningArray<number>(
        cell.element,
        `cell ${cell.id}.element`
      )) as unknown as Element,
      children: TRUSTED_OBJECT_FREEZE(snapshotPlanningArray<CellId>(
        cell.children,
        `cell ${cell.id}.children`
      )),
      active: cell.active,
      hidden: cell.hidden,
      ...(cell.sourceElementId === undefined
        ? {}
        : { sourceElementId: cell.sourceElementId }),
      ...(cell.template === undefined ? {} : { template: cell.template })
    });
  const baseSession = state.baseSession;
  const scalarSnapshot = TRUSTED_OBJECT_FREEZE({
    revision: state.revision,
    kind: state.kind,
    nodeCount: state.nodeCount,
    cellCount: state.cellCount,
    activeLeafCount: state.activeLeafCount,
    nextCommandId: state.nextCommandId,
    nextCellOrdinal: state.nextCellOrdinal,
    sortedActiveLeafIdsDirty: state.sortedActiveLeafIdsDirty
  });
  const activeLeafIds = TRUSTED_OBJECT_FREEZE(snapshotPlanningArrayOrSet<CellId>(
    state.activeLeafIds(),
    "active leaf ids"
  ));
  const undoCommands = TRUSTED_OBJECT_FREEZE(
    snapshotPlanningArray<RefinementSessionCommand>(
      state.undoCommands(),
      "undo commands"
    )
  );
  const redoCommands = TRUSTED_OBJECT_FREEZE(
    snapshotPlanningArray<RefinementSessionCommand>(
      state.redoCommands(),
      "redo commands"
    )
  );
  const cells = new TRUSTED_MAP<CellId, ObservedCell>();
  const nodes = new TRUSTED_MAP<number, ObservedNode>();
  const activeMembership = new TRUSTED_MAP<CellId, boolean>();
  const ownersByNodeKey = new TRUSTED_MAP<string, ObservedOwners>();
  const stagedCell = (
    cellId: CellId
  ): RefinementSessionCell | undefined => {
    const observed = planningMapGet(cells, cellId);
    if (observed !== undefined) {
      return observed.snapshot;
    }
    const cell = state.peekCell(cellId);
    if (cell === undefined) {
      return undefined;
    }
    const snapshot = snapshotCell(cell);
    planningMapSet(cells, cellId, {
      snapshot,
      fingerprint: refinementSessionStateCellFingerprintInternal(
        cellId,
        snapshot
      ),
      identity: cell
    });
    return snapshot;
  };
  const stagedNode = (nodeId: number): Point | undefined => {
    const observed = planningMapGet(nodes, nodeId);
    if (observed !== undefined) {
      return observed.snapshot;
    }
    const point = state.peekNode(nodeId);
    if (point === undefined) {
      return undefined;
    }
    const snapshot = TRUSTED_OBJECT_FREEZE(snapshotPlanningArray<number>(
      point,
      `node ${nodeId}`
    )) as unknown as Point;
    planningMapSet(nodes, nodeId, {
      snapshot,
      fingerprint: refinementSessionStateNodeFingerprintInternal(snapshot),
      identity: point
    });
    stagedOwners(exactReaderActiveMergeKey(snapshot));
    return snapshot;
  };
  const stagedActiveMembership = (cellId: CellId): boolean => {
    const observed = planningMapGet(activeMembership, cellId);
    if (observed !== undefined || planningMapHas(activeMembership, cellId)) {
      return observed!;
    }
    const active = state.hasActiveLeaf(cellId);
    planningMapSet(activeMembership, cellId, active);
    return active;
  };
  const stagedOwners = (key: string): readonly CellId[] => {
    const observed = planningMapGet(ownersByNodeKey, key);
    if (observed !== undefined) {
      return observed.snapshot;
    }
    const identity = state.activeOwnersByNodeKey(key);
    const snapshot = TRUSTED_OBJECT_FREEZE(snapshotPlanningArray<CellId>(
      identity,
      `owner mapping ${key}`
    ));
    planningMapSet(ownersByNodeKey, key, { snapshot, identity });
    return snapshot;
  };
  const reader: RefinementSessionStateReader = {
    baseSession,
    get revision() { return scalarSnapshot.revision; },
    get kind() { return scalarSnapshot.kind; },
    get nodeCount() { return scalarSnapshot.nodeCount; },
    get cellCount() { return scalarSnapshot.cellCount; },
    get activeLeafCount() { return scalarSnapshot.activeLeafCount; },
    get nextCommandId() { return scalarSnapshot.nextCommandId; },
    get nextCellOrdinal() { return scalarSnapshot.nextCellOrdinal; },
    get sortedActiveLeafIdsDirty() {
      return scalarSnapshot.sortedActiveLeafIdsDirty;
    },
    peekNode: stagedNode,
    peekCell: stagedCell,
    node: stagedNode,
    cell: stagedCell,
    hasActiveLeaf: stagedActiveMembership,
    activeLeafIds: () => activeLeafIds,
    activeOwnersByNodeKey: stagedOwners,
    undoCommands: () => undoCommands,
    redoCommands: () => redoCommands
  };
  return {
    reader,
    commit() {
      const cellEntries: {
        cellId: CellId;
        fingerprint: string;
        identity: RefinementSessionCell;
      }[] = [];
      TRUSTED_REFLECT_APPLY(
        TRUSTED_MAP_FOR_EACH,
        cells,
        [(observed: ObservedCell, cellId: CellId) => {
          TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, cellEntries, [{
            cellId,
            fingerprint: observed.fingerprint,
            identity: observed.identity
          }]);
        }]
      );
      const nodeEntries: {
        nodeId: number;
        fingerprint: string;
        identity: Point;
      }[] = [];
      TRUSTED_REFLECT_APPLY(
        TRUSTED_MAP_FOR_EACH,
        nodes,
        [(observed: ObservedNode, nodeId: number) => {
          TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, nodeEntries, [{
            nodeId,
            fingerprint: observed.fingerprint,
            identity: observed.identity
          }]);
        }]
      );
      const activeMembershipEntries: {
        cellId: CellId;
        active: boolean;
      }[] = [];
      TRUSTED_REFLECT_APPLY(
        TRUSTED_MAP_FOR_EACH,
        activeMembership,
        [(active: boolean, cellId: CellId) => {
          TRUSTED_REFLECT_APPLY(
            TRUSTED_ARRAY_PUSH,
            activeMembershipEntries,
            [{ cellId, active }]
          );
        }]
      );
      const ownerEntries: {
        key: string;
        owners: readonly CellId[];
        identity: readonly CellId[];
      }[] = [];
      TRUSTED_REFLECT_APPLY(
        TRUSTED_MAP_FOR_EACH,
        ownersByNodeKey,
        [(observed: ObservedOwners, key: string) => {
          TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, ownerEntries, [{
            key,
            owners: observed.snapshot,
            identity: observed.identity
          }]);
        }]
      );
      const prepared = prepareRefinementSessionStateReferenceBatchInternal(
        state,
        {
          baseSession,
          revision: scalarSnapshot.revision,
          kind: scalarSnapshot.kind,
          nodeCount: scalarSnapshot.nodeCount,
          cellCount: scalarSnapshot.cellCount,
          activeLeafCount: scalarSnapshot.activeLeafCount,
          nextCommandId: scalarSnapshot.nextCommandId,
          nextCellOrdinal: scalarSnapshot.nextCellOrdinal,
          sortedActiveLeafIdsDirty: scalarSnapshot.sortedActiveLeafIdsDirty,
          cells: cellEntries,
          nodes: nodeEntries,
          activeMembership: activeMembershipEntries,
          activeLeafIds,
          ownersByNodeKey: ownerEntries
        }
      );
      commitRefinementSessionStateReferenceBatchInternal(state, prepared);
    }
  };
}

function completeTransitionHistoryComponentFromState(
  state: RefinementSessionStateReader,
  discovered: DiscoveredTransitionHistoryComponent,
  collidingTransitionParentIds: readonly CellId[]
): DiscoveredTransitionHistoryComponent {
  if (collidingTransitionParentIds.length === 0) {
    throw new Error(
      "history transaction could not isolate colliding transition parents"
    );
  }
  const componentCellIds = new Set(
    discovered.component.componentCellIds
  );
  for (const cellId of collidingTransitionParentIds) {
    collectRefinementCellDescendantsFromState(
      state,
      cellId,
      componentCellIds
    );
  }
  return {
    supportCommands: discovered.supportCommands,
    component: {
      ...discovered.component,
      collidingTransitionParentIds: Object.freeze([
        ...collidingTransitionParentIds
      ]),
      componentCellIds
    }
  };
}

function buildRefinementSessionPatchPlan(
  session: RefinementSession,
  cellIds: CellId[],
  options: RefinementSessionPatchOptions
): RefinementSessionPatchPlanInternal {
  return buildRefinementSessionPatchPlanFromState(
    createDirectRefinementSessionState(session, exactActiveMergeKey),
    cellIds,
    options,
    {
      baseSessionRecipes: true,
      buildComplete(buildOptions) {
        return buildActiveMeshWithMap(session, buildOptions);
      },
      buildPatch(selectedCellIds, patchOptions) {
        return buildRefinementPatchActiveMesh(
          session,
          selectedCellIds,
          patchOptions
        );
      },
      buildSameLevel(level, patchOptions) {
        return buildSameLevelRefinementPlanningMesh(
          session,
          level,
          patchOptions
        );
      }
    }
  );
}

interface RefinementSessionPlanningActiveBuilds {
  readonly baseSessionRecipes?: true;
  buildComplete(options: BuildActiveMeshOptions): ActiveMeshBuildResult;
  buildPatch(
    selectedCellIds: readonly CellId[],
    options: RefinementSessionPatchOptions
  ): ActiveMeshBuildResult;
  buildSameLevel(
    level: number,
    options: RefinementSessionPatchOptions
  ): ActiveMeshBuildResult;
}

interface HistoryPlanningScope {
  readonly activeCellIds: readonly CellId[];
  readonly geometryResolution: ActiveMeshGeometryResolution;
}

function historyPlanningScope(
  overlay: RefinementSessionOverlay,
  context: TransitionRebuildContext
): HistoryPlanningScope {
  return {
    activeCellIds: transitionContextActiveCellIdsFromOverlay(overlay, context),
    geometryResolution: context.faceResolution
  };
}

function historyPlanningBuilds(
  state: RefinementSessionStateReader,
  scope: HistoryPlanningScope
): RefinementSessionPlanningActiveBuilds {
  const build = (ids: readonly CellId[], options: BuildActiveMeshOptions) =>
    buildActiveMeshForStateCellIdsWithMap(state, ids, options, scope.geometryResolution);
  const patchOptions = (options: RefinementSessionPatchOptions): BuildActiveMeshOptions => ({
    mergeNodes: true,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false,
    ...(options.mergeTolerance === undefined ? {} : { mergeTolerance: options.mergeTolerance })
  });
  return {
    buildComplete: (options) => build(scope.activeCellIds, options),
    buildPatch: (ids, options) => build(
      collectRefinementPatchActiveCellIdsFromState(state, ids, scope.activeCellIds),
      patchOptions(options)
    ),
    buildSameLevel: (level, options) => build(
      scope.activeCellIds.filter((id) => {
        const cell = requiredSessionStateCell(state, id);
        return cell.level === level && isRefinableSessionCell(cell);
      }),
      patchOptions(options)
    )
  };
}

function buildHistoryRefinementPatchPlan(
  overlay: RefinementSessionOverlay,
  cellIds: CellId[],
  options: RefinementSessionPatchOptions,
  context: TransitionRebuildContext
): RefinementSessionPatchPlanInternal {
  const scope = historyPlanningScope(overlay, context);
  const staged = stageRefinementSessionPlanningReferences(overlay);
  const builds = historyPlanningBuilds(staged.reader, scope);
  const resolved = resolveSessionStatePatchOptions(staged.reader, cellIds, options, scope);
  const plan = buildRefinementSessionPatchPlanFromState(staged.reader, cellIds, resolved, builds);
  staged.commit();
  return plan;
}

function buildRefinementSessionPatchPlanFromState(
  state: RefinementSessionStateReader,
  cellIds: CellId[],
  options: RefinementSessionPatchOptions,
  concreteBuilds?: RefinementSessionPlanningActiveBuilds
): RefinementSessionPatchPlanInternal {
  const validation = validateRefinementSessionStateSelection(state, cellIds);
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }

  const usesSameLevelPlanning = options.hexRefinementRatio === 2
    && options.hexTwoToOneSelectionMode === "local"
    && validation.level !== undefined
    && validation.level > 0;
  const sourceActive = options.activeBuild ?? (usesSameLevelPlanning
    ? (concreteBuilds?.buildComplete({
        mergeNodes: true,
        includeSessionNodeIdByNodeId: false,
        includeSessionNodeIdsByNodeId: false,
        ...(options.mergeTolerance !== undefined ? { mergeTolerance: options.mergeTolerance } : {})
      }) ?? buildActiveMeshWithMapFromSessionStateInternal(state, {
        mergeNodes: true,
        includeSessionNodeIdByNodeId: false,
        includeSessionNodeIdsByNodeId: false,
        ...(options.mergeTolerance !== undefined ? { mergeTolerance: options.mergeTolerance } : {})
      }))
    : (concreteBuilds?.buildPatch(validation.cellIds, options)
      ?? buildRefinementPatchActiveMeshFromState(
        state,
        validation.cellIds,
        options
      )));
  const active = usesSameLevelPlanning
    ? (concreteBuilds?.buildSameLevel(validation.level!, options)
      ?? buildSameLevelRefinementPlanningMeshFromState(
        state,
        validation.level!,
        options
      ))
    : sourceActive;
  const selectedElementIds = validation.cellIds
    .map((cellId) => activeBuildElementIdByCellIdFromState(
      state,
      active,
      cellId,
      validation.cellIds
    ))
    .filter((elementId): elementId is number => elementId !== undefined);
  if (selectedElementIds.length !== validation.cellIds.length) {
    throw new Error("refinement selection contains cells outside the active mesh");
  }
  const transitionSupportCellIds = stableCellIds(
    options.transitionSupportCellIds ?? []
  );
  const transitionSupportElementIds =
    transitionSupportCellIds.map((cellId) =>
      activeBuildElementIdByCellIdFromState(
        state,
        active,
        cellId,
        transitionSupportCellIds
      )
    );
  const inactiveTransitionSupportCellIds =
    transitionSupportCellIds.filter(
      (_, index) =>
        transitionSupportElementIds[index] === undefined
    );
  if (inactiveTransitionSupportCellIds.length > 0) {
    throw historyConflict(
      "transition support contains cells outside the active planning mesh",
      inactiveTransitionSupportCellIds
    );
  }

  const planningOptions: RefineOptions & TwoToOneCompensationCarrier = {
    includeTransitions: options.includeTransitions ?? true,
    ...(options.hexRefinementRatio !== undefined
      ? { hexRefinementRatio: options.hexRefinementRatio }
      : {}),
    ...(options.hexTwoToOneSelectionMode === undefined
      ? {}
      : { hexTwoToOneSelectionMode: options.hexTwoToOneSelectionMode }),
    ...(options.hexTwoToOneCompensation === undefined
      ? {}
      : { hexTwoToOneCompensation: options.hexTwoToOneCompensation }),
    ...(options.rebuildExistingTransitions === undefined
      ? {}
      : { rebuildExistingTransitions: options.rebuildExistingTransitions }),
    transitionSupportElementIds:
      transitionSupportElementIds as number[],
    regularizeHexSelection: false,
    ...(options.mergeTolerance !== undefined ? { mergeTolerance: options.mergeTolerance } : {})
  };
  let classifiedPlan: ReturnType<typeof buildDefaultRefinementPlan>;
  try {
    classifiedPlan = buildDefaultRefinementPlan(
      mutableMeshView(active.mesh),
      selectedElementIds,
      planningOptions
    );
  } catch (error) {
    if (
      error instanceof TwoToOnePlanningError
      && !planningDiagnosticUsesCellIds(error)
    ) {
      planningActiveByNumericError.set(
        error as TwoToOnePlanningError<number>,
        active
      );
    }
    throw error;
  }
  const replacements = classifiedPlan.replacements;
  const replacementParentIds = replacementParentCellIdsFromState(
    state,
    active,
    replacements,
    validation.cellIds
  );
  const parentIds = new Set<CellId>();
  for (let index = 0; index < replacements.length; index += 1) {
    const replacement = replacements[index]!;
    const parentId = replacementParentIds[index]!;
    const parent = requiredSessionStateCell(state, parentId);
    if (!isRefinableSessionCell(parent)) {
      throw new Error(`transition layer cells cannot be refined: ${parentId}`);
    }
    if (parent.level !== validation.level) {
      throw new Error(`refinement patch crosses levels: ${parentId}`);
    }
    parentIds.add(parentId);
  }
  const sourceReplacements = active === sourceActive
    ? replacements
    : mapPlanningReplacementsToSourceState(
        state,
        sourceActive,
        active,
        replacements,
        replacementParentIds
      );
  if (usesSameLevelPlanning) {
    validateSameLevelPlanningConformance(
      sourceActive,
      sourceReplacements,
      options.mergeTolerance
    );
  }
  const quality = state.kind === "H1" && sourceReplacements.length > 0
    ? assertHexPatchQuality(mutableMeshView(sourceActive.mesh), sourceReplacements)
    : undefined;
  const twoToOne = classifiedPlan.twoToOne
    ? mapTwoToOneReportToCellIdsFromState(
        state,
        active,
        classifiedPlan.twoToOne,
        state.activeLeafCount,
        validation.cellIds
      )
    : undefined;
  const recipe = concreteBuilds?.baseSessionRecipes !== true
    ? createRefinementSessionCommandRecipeFromState(
        state,
        validation.cellIds,
        options
      )
    : createRefinementSessionCommandRecipe(
        state.baseSession,
        validation.cellIds,
        options
      );

  return finalizeRefinementSessionPatchPlan({
    sourceActive,
    planningActive: active,
    replacements,
    sourceReplacements,
    hiddenCellIds: [...parentIds].sort(compareCellIds),
    recipe,
    ...(quality ? { quality } : {}),
    ...(twoToOne
      ? { twoToOne }
      : {})
  });
}

function refinementCellFacesFromState(
  state: Pick<RefinementSessionStateReader, "node" | "nodeCount">,
  cell: RefinementSessionCell
): Array<GeometricFace<CellId>> {
  if (cell.kind !== "H1" || cell.element.length !== 8) {
    throw new Error(`cell ${cell.id} has invalid Hex connectivity`);
  }
  return H1_FACES.map((face) => {
    const nodeIds = face.map((localNodeId) => {
      const nodeId = cell.element[localNodeId - 1];
      if (nodeId === undefined) {
        throw new Error(`cell ${cell.id} has an invalid Hex face`);
      }
      activeSessionStateNode(state, nodeId, cell.id);
      return nodeId;
    });
    return {
      owner: cell.id,
      nodeIds,
      points: nodeIds.map((nodeId) =>
        activeSessionStateNode(state, nodeId, cell.id)
      )
    };
  });
}

function createRefinementSessionCommandRecipe(
  session: RefinementSession,
  selectedCellIds: readonly CellId[],
  options: RefinementSessionPatchOptions
): RefinementSessionCommandRecipeV1 {
  return createRefinementSessionCommandRecipeWithGeometry(
    selectedCellIds,
    options,
    (cellId) => refinementCellGeometrySnapshot(session, cellId)
  );
}

function createRefinementSessionCommandRecipeFromState(
  state: RefinementSessionStateReader,
  selectedCellIds: readonly CellId[],
  options: RefinementSessionPatchOptions
): RefinementSessionCommandRecipeV1 {
  return createRefinementSessionCommandRecipeWithGeometry(
    selectedCellIds,
    options,
    (cellId) => refinementCellGeometrySnapshotFromState(state, cellId)
  );
}

function createRefinementSessionCommandRecipeWithGeometry(
  selectedCellIds: readonly CellId[],
  options: RefinementSessionPatchOptions,
  geometrySnapshot: (cellId: CellId) => RefinementCellGeometrySnapshot
): RefinementSessionCommandRecipeV1 {
  const stableSelectedCellIds = stableCellIds(selectedCellIds);
  const stableTransitionSupportCellIds = stableCellIds(
    options.transitionSupportCellIds ?? []
  );
  const normalizedCompensation = (
    options as Partial<ResolvedRefinementSessionPatchOptions>
  ).normalizedTwoToOneCompensation
    ?? normalizeTwoToOneCompensation(
      stableSelectedCellIds.length,
      snapshotRecipeCompensationCarrier(options)
    );
  return freezeRefinementSessionCommandRecipe({
    version: 1,
    selectedCellIds: stableSelectedCellIds,
    selectedCellGeometry: stableSelectedCellIds.map((cellId) =>
      geometrySnapshot(cellId)
    ),
    transitionSupportCellIds: stableTransitionSupportCellIds,
    transitionSupportCellGeometry:
      stableTransitionSupportCellIds.map((cellId) =>
        geometrySnapshot(cellId)
      ),
    options: {
      includeTransitions: options.includeTransitions ?? true,
      hexRefinementRatio: options.hexRefinementRatio ?? 3,
      hexTwoToOneSelectionMode:
        options.hexTwoToOneSelectionMode ?? "section",
      hexTwoToOneCompensation: normalizedCompensation,
      rebuildExistingTransitions:
        normalizedCompensation.mode !== "none",
      ...(options.mergeTolerance === undefined
        ? {}
        : { mergeTolerance: options.mergeTolerance })
    }
  });
}

function snapshotRecipeCompensationCarrier(
  options: RefinementSessionPatchOptions
): TwoToOneCompensationCarrier {
  const carrier: TwoToOneCompensationCarrier = {};
  const optionDescriptors =
    Object.getOwnPropertyDescriptors(options);
  const rebuildDescriptor =
    optionDescriptors.rebuildExistingTransitions;
  if (
    rebuildDescriptor !== undefined
    && "value" in rebuildDescriptor
    && typeof rebuildDescriptor.value === "boolean"
  ) {
    carrier.rebuildExistingTransitions =
      rebuildDescriptor.value;
  }
  const compensationDescriptor =
    optionDescriptors.hexTwoToOneCompensation;
  if (
    compensationDescriptor === undefined
    || !("value" in compensationDescriptor)
    || typeof compensationDescriptor.value !== "object"
    || compensationDescriptor.value === null
  ) {
    return carrier;
  }
  const compensationDescriptors =
    Object.getOwnPropertyDescriptors(
      compensationDescriptor.value
    );
  const compensation: TwoToOneCompensationOptions = {};
  const modeDescriptor = compensationDescriptors.mode;
  if (modeDescriptor !== undefined) {
    if (
      !("value" in modeDescriptor)
      || (
        modeDescriptor.value !== "none"
        && modeDescriptor.value !== "selection"
        && modeDescriptor.value !== "local-topology"
      )
    ) {
      return carrier;
    }
    compensation.mode = modeDescriptor.value;
  }
  for (const key of [
    "maxAddedParentLayers",
    "maxAddedParentCount"
  ] as const) {
    const descriptor = compensationDescriptors[key];
    if (descriptor === undefined) {
      continue;
    }
    if (
      !("value" in descriptor)
      || !Number.isSafeInteger(descriptor.value)
      || descriptor.value < 0
    ) {
      return carrier;
    }
    compensation[key] = descriptor.value;
  }
  carrier.hexTwoToOneCompensation = compensation;
  return carrier;
}

function refinementCellGeometrySnapshot(
  session: RefinementSession,
  cellId: CellId
): RefinementCellGeometrySnapshot {
  const cell = requiredCell(session, cellId);
  return {
    originalCellId: cell.id,
    kind: cell.kind,
    level: cell.level,
    role: cell.role,
    points: cell.element.map((nodeId) => {
      const point = session.nodes[nodeId - 1];
      if (point === undefined) {
        throw new Error(`cell ${cellId} references missing node ${nodeId}`);
      }
      return [...point];
    })
  };
}

function refinementCellGeometrySnapshotFromState(
  state: RefinementSessionStateReader,
  cellId: CellId
): RefinementCellGeometrySnapshot {
  const cell = requiredSessionStateCell(state, cellId);
  const nodeCount = planningArrayLength(
    cell.element,
    `cell ${cellId}.element`
  );
  const points: Point[] = [];
  for (let index = 0; index < nodeCount; index += 1) {
    const nodeId = planningArrayValue<number>(
      cell.element,
      index,
      `cell ${cellId}.element`
    );
    const point = state.node(nodeId);
    if (point === undefined) {
      throw new Error(`cell ${cellId} references missing node ${nodeId}`);
    }
    TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, points, [
      snapshotPlanningArray<number>(point, `node ${nodeId}`) as Point
    ]);
  }
  return {
    originalCellId: cell.id,
    kind: cell.kind,
    level: cell.level,
    role: cell.role,
    points
  };
}

function replacementParentCellIds(
  active: ActiveMeshBuildResult,
  replacements: readonly ClassifiedReplacement[]
): CellId[] {
  return replacements.map((replacement) => {
    const parentId = activeBuildCellIdByElementId(active, replacement.elementId);
    if (parentId === undefined) {
      throw new Error(`replacement parent element ${replacement.elementId} is outside the active mesh`);
    }
    return parentId;
  });
}

function replacementParentCellIdsFromState(
  state: RefinementSessionStateReader,
  active: ActiveMeshBuildResult,
  replacements: readonly ClassifiedReplacement[],
  diagnosticCellIds: readonly CellId[]
): CellId[] {
  return replacements.map((replacement) =>
    activeBuildCellIdByElementIdFromState(
      state,
      active,
      replacement.elementId,
      diagnosticCellIds
    )
  );
}

function assertRefinementSessionPatchPlanParents(
  session: RefinementSession,
  plan: RefinementSessionPatchPlanInternal
): void {
  const planningParentIds =
    replacementParentCellIds(plan.planningActive, plan.replacements);
  assertActiveBuildCoversSessionCells(
    session,
    plan.planningActive,
    planningParentIds
  );
  if (plan.sourceActive !== plan.planningActive) {
    const sourceParentIds =
      replacementParentCellIds(plan.sourceActive, plan.sourceReplacements);
    assertActiveBuildCoversSessionCells(session, plan.sourceActive, sourceParentIds);
  }
}

function validateRebuiltSupportPlanOwnershipFromState(
  state: RefinementSessionStateReader,
  replacementParentIds: readonly CellId[],
  originalSupportParentIds: readonly CellId[],
  supportCommands: readonly RefinementSessionCommand[],
  tolerance: number
): void {
  const originalSupport = new Set(originalSupportParentIds);
  const supportCreated = new Set(
    supportCommands.flatMap((command) => command.createdCellIds)
  );
  const supportCommandIds = supportCommands.map((command) => command.id);
  const replacementInterfaces = createSessionFaceIndex(tolerance);
  for (const cellId of stableCellIds(replacementParentIds)) {
    const cell = requiredSessionStateCell(state, cellId);
    for (const face of refinementCellFacesFromState(state, cell)) {
      replacementInterfaces.uniqueMatch(face);
      replacementInterfaces.add(face);
    }
    if (
      originalSupport.has(cellId)
      || cell.parentId === undefined
      || supportCreated.has(cellId)
    ) {
      continue;
    }
    throw historyConflict(
      `automatic transition-shell rebuilding would cross refinement-command provenance at ${cellId}`,
      [cellId],
      supportCommandIds
    );
  }
}

function trustedActiveBuildCellFingerprint(
  build: ActiveMeshBuildResult,
  elementId: number
): string | undefined {
  return internalActiveMeshBuildTrust.get(build)
    ?.sessionGuard.cellFingerprintByElementId[elementId]
    ?? activeMeshBuildTrust.get(build)
      ?.sessionGuard.cellFingerprintByElementId[elementId];
}

function activeBuildElementIdByCellIdFromState(
  state: RefinementSessionStateReader,
  build: ActiveMeshBuildResult,
  cellId: CellId,
  diagnosticCellIds: readonly CellId[]
): number | undefined {
  const mappings = ensureTrustedActiveMeshMappings(build, diagnosticCellIds);
  const cell = state.peekCell(cellId);
  if (cell === undefined) {
    if (mappings.elementIdByCellId.has(cellId)) {
      throw sessionFaceResolutionError(
        diagnosticCellIds,
        `refinement patch plan is stale because cell ${cellId} no longer exists`
      );
    }
    return undefined;
  }
  if (!isValidCellOrdinal(cell.ordinal)) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      `refinement patch plan is stale because cell ${cellId} has invalid ordinal ${cell.ordinal}`
    );
  }
  if (cell.ordinal >= mappings.elementIdByCellOrdinalArray.length) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      `refinement patch plan is stale because mapping is missing ordinal slot ${cell.ordinal} for cell ${cellId}`
    );
  }
  const elementId = mappings.elementIdByCellOrdinalArray[cell.ordinal];
  if (elementId === undefined) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      `refinement patch plan is stale because mapping is missing ordinal slot ${cell.ordinal} for cell ${cellId}`
    );
  }
  if (elementId === 0) {
    if (mappings.elementIdByCellId.has(cellId)) {
      throw sessionFaceResolutionError(
        diagnosticCellIds,
        `refinement patch plan is stale because mapping disagrees about inactive cell ${cellId}`
      );
    }
    return undefined;
  }
  if (
    !Number.isSafeInteger(elementId)
    || elementId <= 0
    || mappings.cellIdsByElementIdArray[elementId] !== cellId
    || mappings.elementIdByCellId.get(cellId) !== elementId
    || mappings.cellIdByElementId.get(elementId) !== cellId
  ) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      `refinement patch plan is stale because mapping disagrees for cell ${cellId}`
    );
  }
  if (!cell.active || cell.hidden || !state.hasActiveLeaf(cellId)) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      `refinement patch plan is stale because cell ${cellId} is not an active leaf`
    );
  }
  const mappedCellId = activeBuildCellIdByElementIdFromState(
    state,
    build,
    elementId,
    diagnosticCellIds
  );
  if (mappedCellId !== cellId) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      `refinement patch plan is stale because mapping changed for cell ${cellId}`
    );
  }
  return elementId;
}

function activeBuildCellIdByElementIdFromState(
  state: RefinementSessionStateReader,
  build: ActiveMeshBuildResult,
  elementId: number,
  diagnosticCellIds: readonly CellId[]
): CellId {
  const mappings = ensureTrustedActiveMeshMappings(build, diagnosticCellIds);
  const cellId = mappings.cellIdsByElementIdArray[elementId];
  if (
    !Number.isSafeInteger(elementId)
    || elementId <= 0
    || cellId === undefined
  ) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      `refinement patch plan is stale because element ${elementId} is outside the active mesh`
    );
  }
  const cell = state.peekCell(cellId);
  if (cell === undefined) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      `refinement patch plan is stale because parent cell ${cellId} no longer exists`
    );
  }
  if (
    cell.id !== cellId
    || !isValidCellOrdinal(cell.ordinal)
    || cell.ordinal >= mappings.elementIdByCellOrdinalArray.length
    || mappings.elementIdByCellOrdinalArray[cell.ordinal] !== elementId
  ) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      `refinement patch plan is stale because parent cell ${cellId} has changed ordinal or mapping`
    );
  }
  if (
    mappings.cellIdByElementId.get(elementId) !== cellId
    || mappings.elementIdByCellId.get(cellId) !== elementId
  ) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      `refinement patch plan is stale because forward or reverse mapping changed for parent cell ${cellId}`
    );
  }
  if (!cell.active || cell.hidden || !state.hasActiveLeaf(cellId)) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      `refinement patch plan is stale because parent cell ${cellId} is not an active leaf`
    );
  }

  const expectedFingerprint = trustedActiveBuildCellFingerprint(build, elementId);
  if (
    expectedFingerprint !== undefined
    && expectedFingerprint !== refinementSessionStateCellFingerprint(state, cellId, cell)
  ) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      `external activeBuild is stale because selected cell ${cellId} changed`
    );
  }

  const activeElement = build.mesh.elements[elementId - 1];
  const cellElementLength = planningArrayLength(
    cell.element,
    `cell ${cellId}.element`
  );
  if (
    activeElement === undefined
    || planningArrayLength(
      activeElement,
      `active element ${elementId}`
    ) !== cellElementLength
    || cell.kind !== state.kind
    || build.mesh.kind !== state.kind
  ) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      `refinement patch plan is stale because parent cell ${cellId} connectivity changed`
    );
  }
  const tolerance = build.mergeTolerance ?? 0;
  for (let index = 0; index < cellElementLength; index += 1) {
    const sessionNodeId = planningArrayValue<number>(
      cell.element,
      index,
      `cell ${cellId}.element`
    );
    const activeNodeId = mappings.nodeIdBySessionNodeId.get(sessionNodeId);
    const statePoint = Number.isSafeInteger(sessionNodeId)
      && sessionNodeId > 0
      && sessionNodeId <= state.nodeCount
        ? state.peekNode(sessionNodeId)
        : undefined;
    const activePoint = activeNodeId === undefined
      ? undefined
      : build.mesh.nodes[activeNodeId - 1];
    if (
      activeNodeId === undefined
      || planningArrayValue<number>(
        activeElement,
        index,
        `active element ${elementId}`
      ) !== activeNodeId
      || statePoint === undefined
      || activePoint === undefined
    ) {
      throw sessionFaceResolutionError(
        diagnosticCellIds,
        `refinement patch plan is stale because parent cell ${cellId} connectivity changed`
      );
    }
    if (!pointEquals(statePoint, activePoint, tolerance)) {
      throw sessionFaceResolutionError(
        diagnosticCellIds,
        `refinement patch plan is stale because parent cell ${cellId} geometry changed`
      );
    }
  }
  return cellId;
}

function assertRefinementSessionStatePatchPlanParents(
  state: RefinementSessionStateReader,
  plan: RefinementSessionPatchPlanInternal
): CellId[] {
  const diagnosticCellIds = plan.hiddenCellIds;
  const planningParentIds = plan.replacements.map((replacement) =>
    activeBuildCellIdByElementIdFromState(
      state,
      plan.planningActive,
      replacement.elementId,
      diagnosticCellIds
    )
  );
  if (new Set(planningParentIds).size !== planningParentIds.length) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      "refinement patch plan is stale because a replacement parent is duplicated"
    );
  }
  if (
    planningParentIds.length !== plan.hiddenCellIds.length
    || !sameCellIdSet(planningParentIds, plan.hiddenCellIds)
  ) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      "refinement patch plan is stale because replacement parents and hidden cells disagree"
    );
  }

  const sourceParentIds = plan.sourceReplacements.map((replacement) =>
    activeBuildCellIdByElementIdFromState(
      state,
      plan.sourceActive,
      replacement.elementId,
      diagnosticCellIds
    )
  );
  if (
    sourceParentIds.length !== planningParentIds.length
    || sourceParentIds.some((cellId, index) => cellId !== planningParentIds[index])
  ) {
    throw sessionFaceResolutionError(
      diagnosticCellIds,
      "refinement patch plan is stale because source and planning parents disagree"
    );
  }

  const createdCellIds = new Set<CellId>();
  for (let replacementIndex = 0; replacementIndex < plan.replacements.length; replacementIndex += 1) {
    const replacement = plan.replacements[replacementIndex]!;
    const parentId = planningParentIds[replacementIndex]!;
    const parent = state.peekCell(parentId);
    if (parent === undefined) {
      throw sessionFaceResolutionError(
        diagnosticCellIds,
        `refinement patch plan is stale because parent cell ${parentId} no longer exists`
      );
    }
    const firstChildIndex = planningArrayLength(
      parent.children,
      `cell ${parentId}.children`
    ) + 1;
    for (const [elementIndex, element] of replacement.refinement.elements.entries()) {
      const childId = `${parentId}/${firstChildIndex + elementIndex}`;
      if (createdCellIds.has(childId) || state.peekCell(childId) !== undefined) {
        throw sessionFaceResolutionError(
          diagnosticCellIds,
          `refinement patch plan is stale because child cell ${childId} already exists`
        );
      }
      createdCellIds.add(childId);
      if (element.some((nodeId) =>
        !Number.isSafeInteger(nodeId)
        || nodeId <= 0
        || nodeId > replacement.refinement.nodes.length
      )) {
        throw sessionFaceResolutionError(
          diagnosticCellIds,
          `refinement patch plan has invalid child connectivity for ${childId}`
        );
      }
    }
  }
  return planningParentIds;
}

function mapTwoToOneReportToCellIds(
  active: ActiveMeshBuildResult,
  report: TwoToOneCapabilityReport<number>,
  sourceActiveLeafCount: number
): TwoToOneCapabilityReport<CellId> {
  const mapElementId = (elementId: number): CellId => {
    const cellId = activeBuildCellIdByElementId(active, elementId);
    if (cellId === undefined) {
      throw new Error(`2:1 capability element ${elementId} is outside the active mesh`);
    }
    return cellId;
  };
  const affectedComponentCellIds = report.affectedComponentCellIds.map(mapElementId);
  return {
    status: report.status,
    topologyClass: report.topologyClass,
    originalSelectedCellIds: report.originalSelectedCellIds.map(mapElementId),
    effectiveSelectedCellIds: report.effectiveSelectedCellIds.map(mapElementId),
    actions: report.actions.map((action) => ({
      kind: action.kind,
      reason: action.reason,
      addedParentCellIds: action.addedParentCellIds.map(mapElementId),
      replacedTransitionCellIds: action.replacedTransitionCellIds.map(mapElementId),
      ...(action.templateId === undefined ? {} : { templateId: action.templateId })
    })),
    affectedComponentCellIds,
    preservedFarFieldCellCount:
      sourceActiveLeafCount - new Set(affectedComponentCellIds).size
  };
}

function mapTwoToOneReportToCellIdsFromState(
  state: RefinementSessionStateReader,
  active: ActiveMeshBuildResult,
  report: TwoToOneCapabilityReport<number>,
  sourceActiveLeafCount: number,
  diagnosticCellIds: readonly CellId[]
): TwoToOneCapabilityReport<CellId> {
  const mapElementId = (elementId: number): CellId =>
    activeBuildCellIdByElementIdFromState(
      state,
      active,
      elementId,
      diagnosticCellIds
    );
  const affectedComponentCellIds =
    report.affectedComponentCellIds.map(mapElementId);
  return {
    status: report.status,
    topologyClass: report.topologyClass,
    originalSelectedCellIds: report.originalSelectedCellIds.map(mapElementId),
    effectiveSelectedCellIds: report.effectiveSelectedCellIds.map(mapElementId),
    actions: report.actions.map((action) => ({
      kind: action.kind,
      reason: action.reason,
      addedParentCellIds: action.addedParentCellIds.map(mapElementId),
      replacedTransitionCellIds:
        action.replacedTransitionCellIds.map(mapElementId),
      ...(action.templateId === undefined
        ? {}
        : { templateId: action.templateId })
    })),
    affectedComponentCellIds,
    preservedFarFieldCellCount:
      sourceActiveLeafCount - new Set(affectedComponentCellIds).size
  };
}

const planningActiveByNumericError =
  new WeakMap<TwoToOnePlanningError<number>, ActiveMeshBuildResult>();

function asTwoToOneSessionPlanningError(
  error: unknown,
  selectedCellIds: readonly CellId[],
  active: ActiveMeshBuildResult
): TwoToOnePlanningError<CellId> {
  if (error instanceof TypeError || error instanceof RangeError) {
    throw error;
  }
  if (error instanceof TwoToOnePlanningError) {
    if (planningDiagnosticUsesCellIds(error)) {
      return freezeTwoToOnePlanningErrorDiagnostic(
        cloneCellIdPlanningError(error, selectedCellIds)
      );
    }
    const numericError = error as TwoToOnePlanningError<number>;
    return freezeTwoToOnePlanningErrorDiagnostic(
      mapNumericDiagnosticToCellIds(
        numericError,
        selectedCellIds,
        planningActiveByNumericError.get(numericError) ?? active
      )
    );
  }
  if (error instanceof ExistingTransitionCollisionError) {
    return freezeTwoToOnePlanningErrorDiagnostic(
      new TwoToOnePlanningError(
        "TWO_TO_ONE_CONFORMANCE",
        error.message,
        {
          conflictingCellIds: stableCellIds(selectedCellIds),
          conflictingInterfaces: [],
          attemptedActions: [],
          suggestion: {
            kind: "expand-selection"
          }
        }
      )
    );
  }
  if (error instanceof HexPatchQualityError) {
    return freezeTwoToOnePlanningErrorDiagnostic(
      new TwoToOnePlanningError(
        qualityPlanningErrorCode(error.code),
        error.message,
        {
          conflictingCellIds: stableCellIds(selectedCellIds),
          conflictingInterfaces: [],
          attemptedActions: []
        }
      )
    );
  }
  if (error instanceof DirectTwoToOnePlanningError) {
    const conflictingCellIds = stableCellIds(
      error.conflictingElementIds.flatMap((elementId) => {
        const cellId = activeBuildCellIdByElementId(active, elementId);
        return cellId === undefined ? [] : [cellId];
      })
    );
    return freezeTwoToOnePlanningErrorDiagnostic(
      new TwoToOnePlanningError(
        "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY",
        error.message,
        {
          conflictingCellIds:
            conflictingCellIds.length > 0
              ? conflictingCellIds
              : stableCellIds(selectedCellIds),
          conflictingInterfaces: [],
          attemptedActions: [],
          suggestion: {
            kind: "remesh-source"
          }
        }
      )
    );
  }
  throw error;
}

function mapNumericDiagnosticToCellIds(
  error: TwoToOnePlanningError<number>,
  selectedCellIds: readonly CellId[],
  active: ActiveMeshBuildResult
): TwoToOnePlanningError<CellId> {
  const mapIds = (elementIds: readonly number[]): CellId[] =>
    stableCellIds(elementIds.flatMap((elementId) => {
      const cellId = activeBuildCellIdByElementId(active, elementId);
      return cellId === undefined ? [] : [cellId];
    }));
  const diagnostic = error.diagnostic;
  const conflictingCellIds = mapIds(diagnostic.conflictingCellIds);
  const historyCommandIds = diagnostic.historyCommandIds;
  const suggestion = diagnostic.suggestion;
  return new TwoToOnePlanningError(
    error.code,
    error.message,
    {
      conflictingCellIds:
        conflictingCellIds.length > 0
          ? conflictingCellIds
          : stableCellIds(selectedCellIds),
      conflictingInterfaces: diagnostic.conflictingInterfaces.flatMap((entry) => {
        const firstCellId = activeBuildCellIdByElementId(
          active,
          entry.firstCellId
        );
        if (firstCellId === undefined) {
          return [];
        }
        const secondCellId = entry.secondCellId === undefined
          ? undefined
          : activeBuildCellIdByElementId(active, entry.secondCellId);
        return [{
          firstCellId,
          ...(secondCellId === undefined ? {} : { secondCellId }),
          faceNodeIds: uniqueSortedNumbers(entry.faceNodeIds)
        }];
      }),
      attemptedActions: diagnostic.attemptedActions.map((action) => ({
        kind: action.kind,
        reason: action.reason,
        addedParentCellIds: mapIds(action.addedParentCellIds),
        replacedTransitionCellIds:
          mapIds(action.replacedTransitionCellIds),
        ...(action.templateId === undefined
          ? {}
          : { templateId: action.templateId })
      })),
      ...(historyCommandIds === undefined
        ? {}
        : {
            historyCommandIds:
              [...new Set(historyCommandIds)].sort()
          }),
      ...(suggestion === undefined
        ? {}
        : {
            suggestion: {
              kind: suggestion.kind,
              ...(suggestion.axis === undefined
                ? {}
                : { axis: suggestion.axis }),
              ...(suggestion.side === undefined
                ? {}
                : { side: suggestion.side }),
              ...(suggestion.parentCellIds === undefined
                ? {}
                : {
                    parentCellIds: mapIds(suggestion.parentCellIds)
                  })
            }
          })
    }
  );
}

function planningDiagnosticUsesCellIds(
  error: TwoToOnePlanningError<number | CellId>
): error is TwoToOnePlanningError<CellId> {
  const diagnostic = error.diagnostic;
  const ids: Array<number | CellId> = [
    ...diagnostic.conflictingCellIds,
    ...diagnostic.conflictingInterfaces.flatMap((entry) => [
      entry.firstCellId,
      ...(entry.secondCellId === undefined ? [] : [entry.secondCellId])
    ]),
    ...diagnostic.attemptedActions.flatMap((action) => [
      ...action.addedParentCellIds,
      ...action.replacedTransitionCellIds
    ]),
    ...(diagnostic.suggestion?.parentCellIds ?? [])
  ];
  return ids.some((id) => typeof id === "string");
}

function cloneCellIdPlanningError(
  error: TwoToOnePlanningError<CellId>,
  selectedCellIds: readonly CellId[]
): TwoToOnePlanningError<CellId> {
  const diagnostic = error.diagnostic;
  const conflictingCellIds = stableCellIds(diagnostic.conflictingCellIds);
  const historyCommandIds = diagnostic.historyCommandIds;
  const suggestion = diagnostic.suggestion;
  return new TwoToOnePlanningError(
    error.code,
    error.message,
    {
      conflictingCellIds:
        conflictingCellIds.length > 0
          ? conflictingCellIds
          : stableCellIds(selectedCellIds),
      conflictingInterfaces: diagnostic.conflictingInterfaces.map((entry) => ({
        firstCellId: entry.firstCellId,
        ...(entry.secondCellId === undefined
          ? {}
          : { secondCellId: entry.secondCellId }),
        faceNodeIds: uniqueSortedNumbers(entry.faceNodeIds)
      })),
      attemptedActions: diagnostic.attemptedActions.map((action) => ({
        kind: action.kind,
        reason: action.reason,
        addedParentCellIds: stableCellIds(action.addedParentCellIds),
        replacedTransitionCellIds:
          stableCellIds(action.replacedTransitionCellIds),
        ...(action.templateId === undefined
          ? {}
          : { templateId: action.templateId })
      })),
      ...(historyCommandIds === undefined
        ? {}
        : {
            historyCommandIds:
              [...new Set(historyCommandIds)].sort()
          }),
      ...(suggestion === undefined
        ? {}
        : {
            suggestion: {
              kind: suggestion.kind,
              ...(suggestion.axis === undefined
                ? {}
                : { axis: suggestion.axis }),
              ...(suggestion.side === undefined
                ? {}
                : { side: suggestion.side }),
              ...(suggestion.parentCellIds === undefined
                ? {}
                : {
                    parentCellIds:
                      stableCellIds(suggestion.parentCellIds)
                  })
            }
          })
    }
  );
}

function mapPlanningReplacementsToSource(
  session: RefinementSession,
  sourceActive: ActiveMeshBuildResult,
  planningActive: ActiveMeshBuildResult,
  replacements: readonly ClassifiedReplacement[]
): ClassifiedReplacement[] {
  return replacements.map((replacement) => {
    const cellId = activeBuildCellIdByElementId(planningActive, replacement.elementId);
    const sourceElementId = cellId === undefined
      ? undefined
      : activeBuildElementIdByCellId(session, sourceActive, cellId);
    if (sourceElementId === undefined) {
      throw new Error(
        `same-level refinement parent ${replacement.elementId} is outside the complete active mesh`
      );
    }
    return {
      ...replacement,
      elementId: sourceElementId
    };
  });
}

function mapPlanningReplacementsToSourceState(
  state: RefinementSessionStateReader,
  sourceActive: ActiveMeshBuildResult,
  planningActive: ActiveMeshBuildResult,
  replacements: readonly ClassifiedReplacement[],
  replacementParentIds: readonly CellId[]
): ClassifiedReplacement[] {
  return replacements.map((replacement, index) => {
    const cellId = activeBuildCellIdByElementIdFromState(
      state,
      planningActive,
      replacement.elementId,
      replacementParentIds
    );
    if (cellId !== replacementParentIds[index]) {
      throw new Error(
        `same-level refinement parent ${replacement.elementId} changed during planning`
      );
    }
    const sourceElementId = activeBuildElementIdByCellIdFromState(
      state,
      sourceActive,
      cellId,
      replacementParentIds
    );
    if (sourceElementId === undefined) {
      throw new Error(
        `same-level refinement parent ${replacement.elementId} is outside the complete active mesh`
      );
    }
    return {
      ...replacement,
      elementId: sourceElementId
    };
  });
}

function validateSameLevelPlanningConformance(
  sourceActive: ActiveMeshBuildResult,
  sourceReplacements: readonly ClassifiedReplacement[],
  mergeTolerance?: number
): void {
  const tolerance = mergeTolerance
    ?? minElementEdgeLength(sourceActive.mesh) * 0.000001;
  const prospective = replaceElements(
    mutableMeshView(sourceActive.mesh),
    sourceReplacements,
    tolerance
  );
  const report = checkNoHangingNodes(prospective, tolerance);
  if (!report.ok) {
    throw new ExistingTransitionCollisionError(EXISTING_TRANSITION_COLLISION_ERROR);
  }
}

function buildRefinementPatchActiveMesh(
  session: RefinementSession,
  selectedCellIds: readonly CellId[],
  options: RefinementSessionPatchOptions
): ActiveMeshBuildResult {
  const activeIds = collectRefinementPatchActiveCellIds(session, selectedCellIds);
  return buildActiveMeshForCellIdsWithMap(session, activeIds, {
    mergeNodes: true,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false,
    ...(options.mergeTolerance !== undefined ? { mergeTolerance: options.mergeTolerance } : {})
  }, undefined, false, false);
}

function buildRefinementPatchActiveMeshFromState(
  state: RefinementSessionStateReader,
  selectedCellIds: readonly CellId[],
  options: RefinementSessionPatchOptions
): ActiveMeshBuildResult {
  const activeIds = collectRefinementPatchActiveCellIdsFromState(
    state,
    selectedCellIds
  );
  return buildActiveMeshForSessionStateCellIdsWithMap(
    state,
    activeIds,
    {
      mergeNodes: true,
      includeSessionNodeIdByNodeId: false,
      includeSessionNodeIdsByNodeId: false,
      ...(options.mergeTolerance !== undefined
        ? { mergeTolerance: options.mergeTolerance }
        : {})
    },
    undefined,
    (result, mergeTolerance, measuredResolution) =>
      finalizeActiveMeshBuildFromSessionState(
        result,
        mergeTolerance,
        measuredResolution,
        false
      )
  );
}

function buildSameLevelRefinementPlanningMesh(
  session: RefinementSession,
  level: number,
  options: RefinementSessionPatchOptions
): ActiveMeshBuildResult {
  const activeIds = sortedActiveLeafIdsSnapshot(session).filter((cellId) => {
    const cell = session.cells.get(cellId);
    return cell?.level === level && isRefinableSessionCell(cell);
  });
  return buildActiveMeshForCellIdsWithMap(session, activeIds, {
    mergeNodes: true,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false,
    ...(options.mergeTolerance !== undefined ? { mergeTolerance: options.mergeTolerance } : {})
  }, undefined, false, false);
}

function buildSameLevelRefinementPlanningMeshFromState(
  state: RefinementSessionStateReader,
  level: number,
  options: RefinementSessionPatchOptions,
  scopedActiveIds?: readonly CellId[]
): ActiveMeshBuildResult {
  const sortedActiveIds = scopedActiveIds ?? sortedActiveLeafIdsFromSessionState(state);
  const activeIds: CellId[] = [];
  const activeIdCount = planningArrayLength(
    sortedActiveIds,
    "sorted reader active cell ids"
  );
  for (let index = 0; index < activeIdCount; index += 1) {
    const cellId = planningArrayValue<CellId>(
      sortedActiveIds,
      index,
      "sorted reader active cell ids"
    );
    const cell = state.cell(cellId);
    if (cell?.level === level && isRefinableSessionCell(cell)) {
      TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, activeIds, [cellId]);
    }
  }
  return buildActiveMeshForSessionStateCellIdsWithMap(
    state,
    activeIds,
    {
      mergeNodes: true,
      includeSessionNodeIdByNodeId: false,
      includeSessionNodeIdsByNodeId: false,
      ...(options.mergeTolerance !== undefined
        ? { mergeTolerance: options.mergeTolerance }
        : {})
    },
    undefined,
    (result, mergeTolerance, measuredResolution) =>
      finalizeActiveMeshBuildFromSessionState(
        result,
        mergeTolerance,
        measuredResolution,
        false
      )
  );
}

function collectRefinementPatchActiveCellIds(
  session: RefinementSession,
  selectedCellIds: readonly CellId[]
): CellId[] {
  const haloCellIds = new Set<CellId>(selectedCellIds);

  for (const cellId of selectedCellIds) {
    const cell = requiredCell(session, cellId);
    for (const sessionNodeId of cell.element) {
      const point = session.nodes[sessionNodeId - 1];
      if (!point) {
        throw new Error(`selected cell ${cellId} references missing node ${sessionNodeId}`);
      }
      for (const ownerId of session.activeLeafIdsByNodeKey.get(exactActiveMergeKey(point)) ?? []) {
        haloCellIds.add(ownerId);
      }
    }
  }

  return sortedActiveLeafIdsSnapshot(session).filter((cellId) => haloCellIds.has(cellId));
}

function collectRefinementPatchActiveCellIdsFromState(
  state: RefinementSessionStateReader,
  selectedCellIds: readonly CellId[],
  scopedActiveIds?: readonly CellId[]
): CellId[] {
  const haloCellIds = new Set<CellId>();
  const selectedCellCount = planningArrayLength(
    selectedCellIds,
    "selected reader cell ids"
  );
  for (let index = 0; index < selectedCellCount; index += 1) {
    haloCellIds.add(planningArrayValue<CellId>(
      selectedCellIds,
      index,
      "selected reader cell ids"
    ));
  }

  for (let index = 0; index < selectedCellCount; index += 1) {
    const cellId = planningArrayValue<CellId>(
      selectedCellIds,
      index,
      "selected reader cell ids"
    );
    const cell = requiredSessionStateCell(state, cellId);
    const nodeCount = planningArrayLength(
      cell.element,
      `cell ${cellId}.element`
    );
    for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
      const sessionNodeId = planningArrayValue<number>(
        cell.element,
        nodeIndex,
        `cell ${cellId}.element`
      );
      const point = state.node(sessionNodeId);
      if (point === undefined) {
        throw new Error(
          `selected cell ${cellId} references missing node ${sessionNodeId}`
        );
      }
      const owners = state.activeOwnersByNodeKey(
        exactReaderActiveMergeKey(point)
      );
      const ownerCount = planningArrayLength(
        owners,
        `owners for node ${sessionNodeId}`
      );
      for (let ownerIndex = 0; ownerIndex < ownerCount; ownerIndex += 1) {
        const ownerId = planningArrayValue<CellId>(
          owners,
          ownerIndex,
          `owners for node ${sessionNodeId}`
        );
        haloCellIds.add(ownerId);
      }
    }
  }

  const sortedActiveIds = scopedActiveIds === undefined
    ? sortedActiveLeafIdsFromSessionState(state)
    : [...haloCellIds].filter((id) => state.hasActiveLeaf(id)).sort((left, right) =>
      requiredSessionStateCell(state, left).ordinal - requiredSessionStateCell(state, right).ordinal
      || compareCellIds(left, right)
    );
  const activeIds: CellId[] = [];
  const activeIdCount = planningArrayLength(
    sortedActiveIds,
    "sorted reader active cell ids"
  );
  for (let index = 0; index < activeIdCount; index += 1) {
    const cellId = planningArrayValue<CellId>(
      sortedActiveIds,
      index,
      "sorted reader active cell ids"
    );
    if (haloCellIds.has(cellId)) {
      TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, activeIds, [cellId]);
    }
  }
  return activeIds;
}

export function validateRefinementSessionSelection(
  session: RefinementSession,
  cellIds: CellId[]
): RefinementSessionSelectionValidation {
  const uniqueCellIds = [...new Set(cellIds)];
  const missingCellIds: CellId[] = [];
  const inactiveCellIds: CellId[] = [];
  const transitionCellIds: CellId[] = [];
  const mixedLevelCellIds: CellId[] = [];
  const errors: string[] = [];
  let level: number | undefined;

  if (uniqueCellIds.length === 0) {
    errors.push("refinement selection must contain at least one cell");
  }

  for (const cellId of uniqueCellIds) {
    const cell = session.cells.get(cellId);
    if (!cell) {
      missingCellIds.push(cellId);
      continue;
    }
    if (!cell.active || cell.hidden || !session.activeLeafIds.has(cellId)) {
      inactiveCellIds.push(cellId);
    }
    if (isTransitionSessionCell(cell)) {
      transitionCellIds.push(cellId);
    }
    if (level === undefined) {
      level = cell.level;
    } else if (cell.level !== level) {
      mixedLevelCellIds.push(cellId);
    }
  }

  if (missingCellIds.length > 0) {
    errors.push(`cells do not exist: ${missingCellIds.join(", ")}`);
  }
  if (inactiveCellIds.length > 0) {
    errors.push(`cells are not active leaves: ${inactiveCellIds.join(", ")}`);
  }
  if (transitionCellIds.length > 0) {
    errors.push(`transition layer cells cannot be refined: ${transitionCellIds.join(", ")}`);
  }
  if (mixedLevelCellIds.length > 0) {
    errors.push(`refinement selection crosses levels: ${mixedLevelCellIds.join(", ")}`);
  }

  return {
    ok: errors.length === 0,
    cellIds: uniqueCellIds,
    level,
    missingCellIds,
    inactiveCellIds,
    transitionCellIds,
    mixedLevelCellIds,
    errors
  };
}

function validateRefinementSessionStateSelection(
  state: RefinementSessionStateReader,
  cellIds: CellId[]
): RefinementSessionSelectionValidation {
  const uniqueCellIds: CellId[] = [];
  const seenCellIds = new Set<CellId>();
  const inputCellCount = planningArrayLength(
    cellIds,
    "reader selection cell ids"
  );
  for (let index = 0; index < inputCellCount; index += 1) {
    const cellId = planningArrayValue<CellId>(
      cellIds,
      index,
      "reader selection cell ids"
    );
    if (!seenCellIds.has(cellId)) {
      seenCellIds.add(cellId);
      TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, uniqueCellIds, [cellId]);
    }
  }
  const missingCellIds: CellId[] = [];
  const inactiveCellIds: CellId[] = [];
  const transitionCellIds: CellId[] = [];
  const mixedLevelCellIds: CellId[] = [];
  const errors: string[] = [];
  let level: number | undefined;

  if (uniqueCellIds.length === 0) {
    errors.push("refinement selection must contain at least one cell");
  }

  const uniqueCellCount = planningArrayLength(
    uniqueCellIds,
    "unique reader selection cell ids"
  );
  for (let index = 0; index < uniqueCellCount; index += 1) {
    const cellId = planningArrayValue<CellId>(
      uniqueCellIds,
      index,
      "unique reader selection cell ids"
    );
    const cell = state.cell(cellId);
    if (cell === undefined) {
      missingCellIds.push(cellId);
      continue;
    }
    if (!cell.active || cell.hidden || !state.hasActiveLeaf(cellId)) {
      inactiveCellIds.push(cellId);
    }
    if (isTransitionSessionCell(cell)) {
      transitionCellIds.push(cellId);
    }
    if (level === undefined) {
      level = cell.level;
    } else if (cell.level !== level) {
      mixedLevelCellIds.push(cellId);
    }
  }

  if (missingCellIds.length > 0) {
    errors.push(`cells do not exist: ${missingCellIds.join(", ")}`);
  }
  if (inactiveCellIds.length > 0) {
    errors.push(`cells are not active leaves: ${inactiveCellIds.join(", ")}`);
  }
  if (transitionCellIds.length > 0) {
    errors.push(
      `transition layer cells cannot be refined: ${transitionCellIds.join(", ")}`
    );
  }
  if (mixedLevelCellIds.length > 0) {
    errors.push(
      `refinement selection crosses levels: ${mixedLevelCellIds.join(", ")}`
    );
  }

  return {
    ok: errors.length === 0,
    cellIds: uniqueCellIds,
    level,
    missingCellIds,
    inactiveCellIds,
    transitionCellIds,
    mixedLevelCellIds,
    errors
  };
}

export function isRefinableSessionCell(cell: RefinementSessionCell): boolean {
  return cell.active && !cell.hidden && !isTransitionSessionCell(cell);
}

function isTransitionSessionCell(cell: RefinementSessionCell): boolean {
  return isTransitionSessionRole(cell.role);
}

function isTransitionSessionRole(role: RefinementSessionCellRole): boolean {
  return role === "face-transition" || role === "edge-transition" || role === "corner-transition";
}

export function undoRefinementSession(session: RefinementSession): RefinementSessionCommand | undefined {
  const mutable = mutableRefinementSession(session);
  const command = mutable.undoStack.at(-1);
  if (!command) {
    return undefined;
  }
  const state = createDirectRefinementSessionState(session, exactActiveMergeKey);
  const createdCellIds = command.createdCellIds;
  const reactivatedCellIds = command.reactivatedCellIds ?? [];
  const hiddenCellIds = command.hiddenCellIds;
  assertHistoryStateCellsReadyForActiveMutation(state, createdCellIds);
  assertHistoryStateCellsReadyForActiveMutation(state, reactivatedCellIds);
  assertHistoryStateCellsReadyForActiveMutation(state, hiddenCellIds);
  mutable.undoStack.pop();
  for (const cellId of createdCellIds) {
    const cell = requiredStateMutableCell(state, cellId);
    cell.active = false;
    cell.hidden = true;
    state.removeActiveLeaf(cellId);
  }
  for (const cellId of reactivatedCellIds) {
    const cell = requiredStateMutableCell(state, cellId);
    cell.active = false;
    cell.hidden = true;
    state.removeActiveLeaf(cellId);
  }
  for (const cellId of hiddenCellIds) {
    const cell = requiredStateMutableCell(state, cellId);
    cell.active = true;
    cell.hidden = false;
    state.addActiveLeaf(cellId);
  }
  mutable.redoStack.push(command);
  mutable.revision += 1;
  return command;
}

export function redoRefinementSession(session: RefinementSession): RefinementSessionCommand | undefined {
  const mutable = mutableRefinementSession(session);
  const command = mutable.redoStack.at(-1);
  if (!command) {
    return undefined;
  }
  const state = createDirectRefinementSessionState(session, exactActiveMergeKey);
  const hiddenCellIds = command.hiddenCellIds;
  const activeCreatedCellIds =
    command.activeCreatedCellIds ?? command.createdCellIds;
  const reactivatedCellIds = command.reactivatedCellIds ?? [];
  assertHistoryStateCellsReadyForActiveMutation(state, hiddenCellIds);
  assertHistoryStateCellsReadyForActiveMutation(state, activeCreatedCellIds);
  assertHistoryStateCellsReadyForActiveMutation(state, reactivatedCellIds);
  mutable.redoStack.pop();
  for (const cellId of hiddenCellIds) {
    const cell = requiredStateMutableCell(state, cellId);
    cell.active = false;
    cell.hidden = true;
    state.removeActiveLeaf(cellId);
  }
  for (const cellId of activeCreatedCellIds) {
    const cell = requiredStateMutableCell(state, cellId);
    cell.active = true;
    cell.hidden = false;
    state.addActiveLeaf(cellId);
  }
  for (const cellId of reactivatedCellIds) {
    const cell = requiredStateMutableCell(state, cellId);
    cell.active = true;
    cell.hidden = false;
    state.addActiveLeaf(cellId);
  }
  mutable.undoStack.push(command);
  mutable.revision += 1;
  return command;
}

function baseCellId(elementId: number): CellId {
  return `e${elementId}`;
}

function cloneMesh(mesh: ReadonlyMesh): Mesh {
  const clonedExtras = cloneEnumerableExtraProperties(
    mesh,
    new Set(["nodes", "elements", "kind"])
  );
  const clone = {
    ...clonedExtras,
    nodes: mesh.nodes.map((point) => [...point]),
    elements: mesh.elements.map((element) => [...element])
  };
  return (mesh.kind ? { ...clone, kind: mesh.kind } : clone) as Mesh;
}

function cloneEnumerableExtraProperties(
  source: object,
  excludedKeys: ReadonlySet<string>
): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!excludedKeys.has(key)) {
      extras[key] = structuredClone(value);
    }
  }
  return extras;
}

function mutableMeshView(mesh: ReadonlyMesh): Mesh {
  // These call sites only read mesh geometry; legacy kernels still accept Mesh.
  return mesh as Mesh;
}

function mutableRefinementSession(session: RefinementSession): MutableRefinementSession {
  return session as unknown as MutableRefinementSession;
}

function mutableRefinementSessionCell(
  cell: RefinementSessionCell
): MutableRefinementSessionCell {
  return cell as unknown as MutableRefinementSessionCell;
}

function requiredCell(
  session: RefinementSession,
  cellId: CellId
): MutableRefinementSessionCell {
  const cell = session.cells.get(cellId);
  if (!cell) {
    throw new Error(`cell ${cellId} does not exist`);
  }
  return mutableRefinementSessionCell(cell);
}

function requiredSessionStateCell(
  state: Pick<RefinementSessionStateReader, "cell">,
  cellId: CellId
): RefinementSessionCell {
  const cell = state.cell(cellId);
  if (cell === undefined) {
    throw new Error(`cell ${cellId} does not exist`);
  }
  return cell;
}

function activeSessionStateNode(
  state: Pick<RefinementSessionStateReader, "node" | "nodeCount">,
  nodeId: number,
  cellId: CellId
): Point {
  const node = Number.isSafeInteger(nodeId)
    && nodeId > 0
    && nodeId <= state.nodeCount
      ? state.node(nodeId)
      : undefined;
  if (node === undefined) {
    throw new Error(`active cell ${cellId} references missing node ${nodeId}`);
  }
  return node;
}

function sortedActiveLeafIdsFromSessionState(
  state: Pick<RefinementSessionStateReader, "activeLeafIds" | "cell">
): CellId[] {
  const activeIds = snapshotPlanningArrayOrSet<CellId>(
    state.activeLeafIds(),
    "reader active leaf ids"
  );
  const entries: { cellId: CellId; ordinal: number }[] = [];
  const activeIdCount = planningArrayLength(
    activeIds,
    "copied reader active leaf ids"
  );
  for (let index = 0; index < activeIdCount; index += 1) {
    const cellId = planningArrayValue<CellId>(
      activeIds,
      index,
      "copied reader active leaf ids"
    );
    TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, entries, [{
      cellId,
      ordinal: state.cell(cellId)?.ordinal ?? Number.MAX_SAFE_INTEGER
    }]);
  }
  TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_SORT, entries, [
    (
      first: { cellId: CellId; ordinal: number },
      second: { cellId: CellId; ordinal: number }
    ) =>
      first.ordinal - second.ordinal
      || (first.cellId < second.cellId ? -1 : first.cellId > second.cellId ? 1 : 0)
  ]);
  const sortedIds: CellId[] = [];
  const entryCount = planningArrayLength(entries, "sorted reader active entries");
  for (let index = 0; index < entryCount; index += 1) {
    TRUSTED_REFLECT_APPLY(TRUSTED_ARRAY_PUSH, sortedIds, [
      planningArrayValue<{ cellId: CellId }>(
        entries,
        index,
        "sorted reader active entries"
      ).cellId
    ]);
  }
  return sortedIds;
}

function sortedActiveLeafIds(session: RefinementSession): readonly CellId[] {
  const mutable = mutableRefinementSession(session);
  if (session.sortedActiveLeafIdsDirty) {
    mutable.sortedActiveLeafIds = sortedActiveLeafIdsSnapshot(session);
    mutable.sortedActiveLeafIdsDirty = false;
  }
  return mutable.sortedActiveLeafIds;
}

function sortedActiveLeafIdsSnapshot(
  session: RefinementSession
): CellId[] {
  return [...session.activeLeafIds].sort(
    (first, second) =>
      cellOrdinal(session, first) - cellOrdinal(session, second)
  );
}

function nextCellOrdinal(session: RefinementSession): number {
  const mutable = mutableRefinementSession(session);
  const ordinal = mutable.nextCellOrdinal ?? session.cells.size + 1;
  mutable.nextCellOrdinal = ordinal + 1;
  return ordinal;
}

function cellOrdinal(session: RefinementSession, cellId: CellId): number {
  return session.cells.get(cellId)?.ordinal ?? Number.MAX_SAFE_INTEGER;
}

function sessionMeshView(session: RefinementSession): Mesh {
  return {
    kind: session.kind,
    nodes: mutableRefinementSession(session).nodes,
    elements: []
  };
}

function buildLocalActiveMeshAroundElements(
  build: ActiveMeshBuildResult,
  seedElementIds: readonly number[]
): {
  mesh: Mesh;
  checkedCellIds: CellId[];
  checkedElementIds: number[];
} {
  if (seedElementIds.length === 0) {
    return {
      mesh: build.mesh.kind ? { kind: build.mesh.kind, nodes: [], elements: [] } : { nodes: [], elements: [] },
      checkedCellIds: [],
      checkedElementIds: []
    };
  }

  const seedNodeIds = new Set<number>();
  const seedElementIdSet = new Set(seedElementIds);
  for (const elementId of seedElementIds) {
    for (const nodeId of build.mesh.elements[elementId - 1] ?? []) {
      seedNodeIds.add(nodeId);
    }
  }

  const checkedElementIds = checkedElementIdsAroundSeeds(build, seedElementIds, seedNodeIds, seedElementIdSet);

  const usedNodeIds = new Set<number>();
  for (const elementId of checkedElementIds) {
    for (const nodeId of build.mesh.elements[elementId - 1] ?? []) {
      usedNodeIds.add(nodeId);
    }
  }
  const nodeIdMap = new Map<number, number>();
  const nodes = [...usedNodeIds].sort((a, b) => a - b).map((nodeId, index) => {
    nodeIdMap.set(nodeId, index + 1);
    return build.mesh.nodes[nodeId - 1]!;
  });
  const elements = checkedElementIds.map((elementId) =>
    (build.mesh.elements[elementId - 1] ?? []).map((nodeId) => {
      const mapped = nodeIdMap.get(nodeId);
      if (mapped === undefined) {
        throw new Error(`local conformance mesh references missing node ${nodeId}`);
      }
      return mapped;
    })
  );

  return {
    mesh: build.mesh.kind ? { kind: build.mesh.kind, nodes, elements } : { nodes, elements },
    checkedCellIds: checkedElementIds
      .map((elementId) => activeBuildCellIdByElementId(build, elementId))
      .filter((cellId): cellId is CellId => cellId !== undefined),
    checkedElementIds
  };
}

function checkedElementIdsAroundSeeds(
  build: ActiveMeshBuildResult,
  seedElementIds: readonly number[],
  seedNodeIds: ReadonlySet<number>,
  seedElementIdSet: ReadonlySet<number>
): number[] {
  const checkedElementIds = new Set<number>(seedElementIds);
  const elementIdsByNodeId = ensureTrustedActiveMeshMappings(build).elementIdsByNodeId;
  if (elementIdsByNodeId) {
    for (const nodeId of seedNodeIds) {
      for (const elementId of elementIdsByNodeId.get(nodeId) ?? []) {
        checkedElementIds.add(elementId);
      }
    }
    return [...checkedElementIds].sort((a, b) => a - b);
  }

  for (let index = 0; index < build.mesh.elements.length; index += 1) {
    const elementId = index + 1;
    if (seedElementIdSet.has(elementId)) {
      continue;
    }
    const element = build.mesh.elements[index]!;
    if (element.some((nodeId) => seedNodeIds.has(nodeId))) {
      checkedElementIds.add(elementId);
    }
  }
  return [...checkedElementIds].sort((a, b) => a - b);
}

function buildElementIdsByNodeId(elements: readonly Element[]): Map<number, number[]> {
  const elementIdsByNodeId = new Map<number, number[]>();
  elements.forEach((element, index) => {
    const elementId = index + 1;
    for (const nodeId of element) {
      const elementIds = elementIdsByNodeId.get(nodeId) ?? [];
      elementIds.push(elementId);
      elementIdsByNodeId.set(nodeId, elementIds);
    }
  });
  return elementIdsByNodeId;
}

function assertHexRefinementQuality(
  parentVertices: readonly Point[],
  refinement: LocalRefinement,
  label: string
): void {
  const report = auditHexRefinementQuality(parentVertices, refinement);
  assertHexRefinementQualityReport(report, label);
}

function namedSetEntries<T extends string | number>(
  sets: RefinementSessionNamedSets<T> | undefined
): Array<[string, readonly T[]]> {
  if (!sets) {
    return [];
  }
  return sets instanceof Map ? [...sets.entries()] : Object.entries(sets);
}

function uniquePreserveOrder<T extends string | number>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function uniqueSortedNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function stableCellIds(cellIds: Iterable<CellId>): CellId[] {
  return [...new Set(cellIds)].sort(compareCellIds);
}

function compareCellIds(a: CellId, b: CellId): number {
  const ap = cellIdParts(a);
  const bp = cellIdParts(b);
  for (let i = 0; i < Math.max(ap.length, bp.length); i += 1) {
    const av = ap[i] ?? -1;
    const bv = bp[i] ?? -1;
    if (av !== bv) {
      return av - bv;
    }
  }
  return compareCodeUnits(a, b);
}

function cellIdParts(cellId: CellId): number[] {
  return cellId.split("/").map((part) => Number(part.replace(/^e/, "")));
}

function compareCodeUnits(first: string, second: string): number {
  const length = Math.min(first.length, second.length);
  for (let index = 0; index < length; index += 1) {
    const difference = first.charCodeAt(index) - second.charCodeAt(index);
    if (difference !== 0) {
      return difference;
    }
  }
  return first.length - second.length;
}
