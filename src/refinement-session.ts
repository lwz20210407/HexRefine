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
  auditHexRefinementPatchQuality,
  auditHexRefinementQuality
} from "./hex-quality.js";
import {
  auditNetHexCellReplacementQuality
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

interface MutableRefinementSessionCell {
  id: CellId;
  ordinal: number;
  parentId?: CellId;
  level: number;
  role: RefinementSessionCellRole;
  kind: ElementKind;
  element: Element;
  children: CellId[];
  active: boolean;
  hidden: boolean;
  sourceElementId?: number;
  template?: string;
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

interface RefinementSessionPatchPlan {
  sourceActive: ActiveMeshBuildResult;
  planningActive: ActiveMeshBuildResult;
  replacements: ClassifiedReplacement[];
  sourceReplacements: ClassifiedReplacement[];
  hiddenCellIds: CellId[];
  quality?: HexRefinementQualitySummary;
  twoToOne?: TwoToOneCapabilityReport<CellId>;
  recipe: RefinementSessionCommandRecipeV1;
}

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

function buildActiveMeshForCellIdsWithMap(
  session: RefinementSession,
  activeIds: readonly CellId[],
  options: BuildActiveMeshOptions = {},
  resolveDefaultMergeTolerance?: (resolution: ActiveMeshGeometryResolution) => number,
  includeProvenance = true,
  includeGeometryResolution = true
): ActiveMeshBuildResult {
  const includeSessionNodeIdByNodeId = options.includeSessionNodeIdByNodeId ?? true;
  const includeSessionNodeIdsByNodeId = options.includeSessionNodeIdsByNodeId ?? true;
  const includeCellIdByElementId = options.includeCellIdByElementId ?? true;
  const includeElementIdByCellId = options.includeElementIdByCellId ?? true;
  const includeReverseNodeMaps = includeSessionNodeIdByNodeId || includeSessionNodeIdsByNodeId;
  if (options.mergeNodes && options.mergeTolerance !== undefined) {
    return buildMergedActiveMeshDirect(
      session,
      activeIds,
      options,
      includeSessionNodeIdByNodeId,
      includeSessionNodeIdsByNodeId,
      includeCellIdByElementId,
      includeElementIdByCellId,
      includeProvenance,
      includeGeometryResolution
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
    const node = session.nodes[sessionNodeId - 1];
    if (!node) {
      throw new Error(`active cell ${cellId} references missing node ${sessionNodeId}`);
    }
    const nextNodeId = nodes.length + 1;
    compactNodeIdBySessionNodeId.set(sessionNodeId, nextNodeId);
    sessionNodeIdByCompactNodeId?.set(nextNodeId, sessionNodeId);
    sessionNodeIdsByCompactNodeId?.set(nextNodeId, [sessionNodeId]);
    nodes.push([...node]);
    return nextNodeId;
  };

  const cellIdByElementId = new Map<number, CellId>();
  const elementIdByCellId = new Map<CellId, number>();
  const cellIdsByElementIdArray: CellId[] = new Array(activeIds.length + 1);
  const elementIdByCellOrdinalArray = new Int32Array(Math.max(session.nextCellOrdinal + 1, session.cells.size + 1));
  const elements = activeIds.map((cellId, index) => {
    const elementId = index + 1;
    const cell = requiredCell(session, cellId);
    if (includeCellIdByElementId) {
      cellIdByElementId.set(elementId, cellId);
    }
    cellIdsByElementIdArray[elementId] = cellId;
    if (includeElementIdByCellId) {
      elementIdByCellId.set(cellId, elementId);
    }
    recordActiveElementByCellOrdinal(elementIdByCellOrdinalArray, cell, elementId);
    return cell.element.map((nodeId) => compactNodeId(nodeId, cellId));
  });

  const mesh: Mesh = { kind: session.kind, nodes, elements };
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
    return finalizeActiveMeshBuild(
      result,
      session,
      activeIds,
      undefined,
      undefined,
      includeProvenance,
      includeGeometryResolution
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
  return finalizeActiveMeshBuild(
    result,
    session,
    activeIds,
    mergeTolerance,
    measuredResolution,
    includeProvenance,
    includeGeometryResolution
  );
}

function buildMergedActiveMeshDirect(
  session: RefinementSession,
  activeIds: readonly CellId[],
  options: BuildActiveMeshOptions,
  includeSessionNodeIdByNodeId: boolean,
  includeSessionNodeIdsByNodeId: boolean,
  includeCellIdByElementId: boolean,
  includeElementIdByCellId: boolean,
  includeProvenance: boolean,
  includeGeometryResolution: boolean
): ActiveMeshBuildResult {
  const tolerance = options.mergeTolerance!;
  const sessionNodes = session.nodes;
  assertMergeToleranceBelowFinalEdgeLimit(
    {
      kind: session.kind,
      nodes: sessionNodes,
      elements: activeIds.map((cellId) => [...requiredCell(session, cellId).element])
    },
    tolerance
  );
  const nodes: Point[] = [];
  const elements: Element[] = new Array(activeIds.length);
  const cellIdByElementId = new Map<number, CellId>();
  const elementIdByCellId = new Map<CellId, number>();
  const cellIdsByElementIdArray: CellId[] = new Array(activeIds.length + 1);
  const elementIdByCellOrdinalArray = new Int32Array(Math.max(session.nextCellOrdinal + 1, session.cells.size + 1));
  const nodeIdBySessionNodeIdArray = new Int32Array(sessionNodes.length + 1);
  const touchedSessionNodeIds: number[] = [];
  const sessionNodeIdByNodeId = includeSessionNodeIdByNodeId ? new Map<number, number>() : undefined;
  const sessionNodeIdsByNodeId = includeSessionNodeIdsByNodeId ? new Map<number, number[]>() : undefined;
  const exactNodeIndexByKey = tolerance === 0 ? new Map<string, number>() : undefined;
  const buckets = tolerance === 0 ? undefined : new Map<string, number[]>();
  const bucketLayout = createMergeBucketLayout(sessionNodes, tolerance);

  for (let index = 0; index < activeIds.length; index += 1) {
    const cellId = activeIds[index]!;
    const elementId = index + 1;
    const cell = requiredCell(session, cellId);
    if (includeCellIdByElementId) {
      cellIdByElementId.set(elementId, cellId);
    }
    cellIdsByElementIdArray[elementId] = cellId;
    if (includeElementIdByCellId) {
      elementIdByCellId.set(cellId, elementId);
    }
    recordActiveElementByCellOrdinal(elementIdByCellOrdinalArray, cell, elementId);
    const sourceElement = cell.element;
    const mappedElement = new Array<number>(sourceElement.length);
    for (let nodeOffset = 0; nodeOffset < sourceElement.length; nodeOffset += 1) {
      const sessionNodeId = sourceElement[nodeOffset]!;
      let nodeId = nodeIdBySessionNodeIdArray[sessionNodeId];
      if (nodeId === 0) {
        const point = sessionNodes[sessionNodeId - 1];
        if (!point) {
          throw new Error(`active cell ${cellId} references missing node ${sessionNodeId}`);
        }
        let nodeIndex: number | undefined;
        if (exactNodeIndexByKey) {
          const exactKey = exactActiveMergeKey(point);
          const exactCandidateIndex = exactNodeIndexByKey.get(exactKey);
          nodeIndex = exactCandidateIndex !== undefined
            && pointEquals(nodes[exactCandidateIndex]!, point, 0)
            ? exactCandidateIndex
            : undefined;
          if (nodeIndex === undefined) {
            nodeIndex = nodes.length;
            nodes.push([...point]);
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
            nodes.push([...point]);
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
          nodes.push([...point]);
        }
        nodeId = nodeIndex! + 1;
        nodeIdBySessionNodeIdArray[sessionNodeId] = nodeId;
        touchedSessionNodeIds.push(sessionNodeId);
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

  const nodeIdBySessionNodeId = new Map<number, number>();
  for (const sessionNodeId of touchedSessionNodeIds) {
    nodeIdBySessionNodeId.set(sessionNodeId, nodeIdBySessionNodeIdArray[sessionNodeId]!);
  }

  const mesh: Mesh = { kind: session.kind, nodes, elements };
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
  return finalizeActiveMeshBuild(
    result,
    session,
    activeIds,
    tolerance,
    undefined,
    includeProvenance,
    includeGeometryResolution
  );
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
  const sessionGuard = createTrustedSessionBuildGuard(session, activeIds);
  activeMeshBuildMappings.set(result, mappings);
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
      addActiveLeafCellId(session, childId);
    });

    parent.children.push(...parentCreatedCellIds);
    parent.active = false;
    parent.hidden = true;
    removeActiveLeafCellId(session, parentId);
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
  prebuiltPlan?: RefinementSessionPatchPlan
): RefinementSessionCommand {
  if (prebuiltPlan !== undefined) {
    return applyRefinementSessionPatchPlan(
      session,
      prebuiltPlan
    );
  }
  const resolvedOptions = resolveSessionPatchOptions(session, cellIds, options);
  try {
    let plan: RefinementSessionPatchPlan;
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
              faceResolution
            );
          replaceRefinementSessionState(
            session,
            transaction.finalSession
          );
          return transaction.command;
        }
      }
      throw error;
    }
    return applyRefinementSessionPatchPlan(session, plan);
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

function resolveSessionPatchOptions(
  session: RefinementSession,
  diagnosticCellIds: readonly CellId[],
  options: RefinementSessionPatchOptions
): ResolvedRefinementSessionPatchOptions {
  const recipeCompensationCarrier =
    snapshotRecipeCompensationCarrier(options);
  const optionDescriptors = Object.getOwnPropertyDescriptors(options);
  const compensationDescriptor = optionDescriptors.hexTwoToOneCompensation;
  delete optionDescriptors.hexTwoToOneCompensation;
  const optionsSnapshot: RefinementSessionPatchOptions = {
    ...Object.defineProperties({}, optionDescriptors)
  };
  assertValidSessionFaceTolerance(optionsSnapshot.mergeTolerance);
  let activeBuild = optionsSnapshot.activeBuild;
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
      optionsSnapshot.mergeTolerance !== undefined
      && (
        recordedTolerance === undefined
        || optionsSnapshot.mergeTolerance !== recordedTolerance
      )
    ) {
      throw sessionFaceResolutionError(
        diagnosticCellIds,
        recordedTolerance === undefined
          ? "external activeBuild does not record a merge tolerance, so requested planning consistency cannot be proven"
          : `external activeBuild merge tolerance ${recordedTolerance} does not match requested merge tolerance ${optionsSnapshot.mergeTolerance}`
      );
    }
  } else {
    const activeCellIds = sortedActiveLeafIdsSnapshot(session);
    const buildOptions: BuildActiveMeshOptions = {
      mergeNodes: true,
      includeSessionNodeIdByNodeId: false,
      includeSessionNodeIdsByNodeId: false,
      ...(optionsSnapshot.mergeTolerance === undefined
        ? {}
        : { mergeTolerance: optionsSnapshot.mergeTolerance })
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
    session.activeLeafIds.size > 0
  );
  const supportsLocalTwoToOneTransitions =
    session.kind === "H1"
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

function applyRefinementSessionPatchPlan(
  session: RefinementSession,
  plan: RefinementSessionPatchPlan
): RefinementSessionCommand {
  assertRefinementSessionPatchPlanParents(session, plan);
  const mutable = mutableRefinementSession(session);
  const {
    planningActive: active,
    replacements,
    hiddenCellIds
  } = plan;
  const createdCellIds: CellId[] = [];
  const createdNodeIds: number[] = [];

  for (const replacement of replacements) {
    const parentId = activeBuildCellIdByElementId(active, replacement.elementId)!;
    const parent = requiredCell(session, parentId);
    const nodeOffset = mutable.nodes.length;
    for (const [index, point] of replacement.refinement.nodes.entries()) {
      mutable.nodes.push([...point]);
      createdNodeIds.push(nodeOffset + index + 1);
    }

    const parentCreatedCellIds: CellId[] = [];
    const firstChildIndex = parent.children.length + 1;
    replacement.refinement.elements.forEach((element, index) => {
      const childId = `${parentId}/${firstChildIndex + index}`;
      parentCreatedCellIds.push(childId);
      createdCellIds.push(childId);
      const child: MutableRefinementSessionCell = {
        id: childId,
        ordinal: nextCellOrdinal(session),
        parentId,
        level: parent.level + 1,
        role: replacement.role,
        kind: parent.kind,
        element: element.map((nodeId) => nodeId + nodeOffset),
        children: [],
        active: true,
        hidden: false,
        template: String(replacement.templateCode)
      };
      if (parent.sourceElementId !== undefined) {
        child.sourceElementId = parent.sourceElementId;
      }
      mutable.cells.set(childId, child);
      addActiveLeafCellId(session, childId);
    });
    parent.children.push(...parentCreatedCellIds);
  }

  for (const parentId of hiddenCellIds) {
    const parent = requiredCell(session, parentId);
    parent.active = false;
    parent.hidden = true;
    removeActiveLeafCellId(session, parentId);
  }

  const command = freezeRefinementSessionCommand({
    id: `cmd-${mutable.nextCommandId}`,
    kind: "refine",
    hiddenCellIds,
    createdCellIds,
    createdNodeIds,
    ...(plan.quality ? { quality: plan.quality } : {}),
    ...(plan.twoToOne
      ? { twoToOne: cloneTwoToOneCapabilityReport(plan.twoToOne) }
      : {}),
    recipe: plan.recipe
  });
  mutable.nextCommandId += 1;
  mutable.undoStack.push(command);
  mutable.redoStack = [];
  mutable.revision += 1;
  return command;
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
  readonly command: RefinementSessionCommand;
  readonly finalSession: RefinementSession;
  readonly preview: RefinementPreview<CellId>;
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

function refineSessionPatchWithRebuiltTransitionShell(
  session: RefinementSession,
  cellIds: readonly CellId[],
  options: ResolvedRefinementSessionPatchOptions,
  faceResolution: SessionFaceResolution
): RefinementSessionCommand & {
  readonly twoToOne: ReadonlyTwoToOneCapabilityReport<CellId>;
} {
  const compensation = options.normalizedTwoToOneCompensation;
  if (compensation === undefined) {
    throw new Error(
      "transition-shell rebuilding requires a normalized compensation snapshot"
    );
  }
  const working = cloneRefinementSession(session);
  const validation = validateRefinementSessionSelection(working, [...cellIds]);
  if (!validation.ok || validation.level === undefined || validation.level < 1) {
    throw new Error(validation.errors.join("; ") || "transition-shell rebuilding requires a refined selection");
  }
  const faceTolerance = faceResolution.tolerance;
  const resolvedOptions: ResolvedRefinementSessionPatchOptions =
    faceResolution.mergeTolerance === undefined
      ? options
      : {
          ...options,
          mergeTolerance: faceResolution.mergeTolerance
        };
  const selectedLevel = validation.level;
  const supportCommands = findSupportCommands(
    working,
    validation.cellIds
  );
  if (supportCommands.length !== 1) {
    throw historyConflict(
      "untouched transition-shell rebuilding requires one supporting root command",
      validation.cellIds,
      supportCommands.map((command) => command.id)
    );
  }
  const supportCommand = supportCommands[0]!;
  const allSupportLayerCellIds = supportCommand.createdCellIds.filter((cellId) => {
    const cell = working.cells.get(cellId);
    return cell?.level === selectedLevel && cell.parentId !== undefined;
  });
  if (allSupportLayerCellIds.length === 0) {
    throw new Error("automatic transition-shell rebuilding could not find the supporting refinement layer");
  }
  const supportLayerCellIds = collectConnectedSupportLayerCells(
    working,
    allSupportLayerCellIds,
    validation.cellIds,
    faceTolerance
  );
  const collidingTransitionParentIds = findCollidingTransitionParentIds(
    working,
    validation.cellIds,
    supportLayerCellIds,
    selectedLevel,
    resolvedOptions,
    faceTolerance
  );
  if (collidingTransitionParentIds.length === 0) {
    throw new Error("automatic transition-shell rebuilding could not isolate the colliding transition parents");
  }
  const nonLeafSupportCellIds = supportLayerCellIds.filter((cellId) => {
    const cell = requiredCell(working, cellId);
    return !cell.active || cell.hidden || !working.activeLeafIds.has(cellId);
  });
  if (nonLeafSupportCellIds.length > 0) {
    throw historyConflict(
      `automatic transition-shell rebuilding requires an untouched supporting layer: ${nonLeafSupportCellIds.join(", ")}`,
      nonLeafSupportCellIds,
      [
        supportCommand.id,
        ...historyCommandIdsForHiddenCells(
          working,
          nonLeafSupportCellIds
        )
      ]
    );
  }

  const originalActiveLeafIds = new Set(session.activeLeafIds);
  const originalCellIds = new Set(session.cells.keys());
  const originalNodeCount = session.nodes.length;
  const originalUndoStack = working.undoStack.slice();
  const compoundCommandId = `cmd-${session.nextCommandId}`;
  const selectedGeometryKeys = validation.cellIds.map((cellId) =>
    refinementCellGeometryKey(working, requiredCell(working, cellId))
  );
  const originalSupportParentIds = [...new Set(supportLayerCellIds.map((cellId) => {
    const parentId = requiredCell(working, cellId).parentId;
    if (parentId === undefined) {
      throw new Error(`supporting cell ${cellId} has no parent`);
    }
    return parentId;
  }))].sort(compareCellIds);
  const previousCoreParentIds = [...new Set(supportLayerCellIds
    .filter((cellId) => requiredCell(working, cellId).role === "selected")
    .map((cellId) => requiredCell(working, cellId).parentId)
    .filter((parentId): parentId is CellId => parentId !== undefined))];
  const rebuiltCoreParentIds = [...new Set([
    ...previousCoreParentIds,
    ...collidingTransitionParentIds
  ])].sort(compareCellIds);
  const previousCoreParentIdSet = new Set(previousCoreParentIds);
  const addedParentCellIds = rebuiltCoreParentIds
    .filter((cellId) => !previousCoreParentIdSet.has(cellId));
  const attemptedAction: TwoToOneCompensationAction<CellId> = {
    kind: "transition-shell-rebuild",
    reason: "the nested core reached an existing 2:1 transition component",
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
    const cell = requiredCell(working, cellId);
    cell.active = false;
    cell.hidden = true;
    removeActiveLeafCellId(working, cellId);
  }
  for (const parentId of originalSupportParentIds) {
    const parent = requiredCell(working, parentId);
    parent.active = true;
    parent.hidden = false;
    addActiveLeafCellId(working, parentId);
  }
  const authorizedCompletionParentIds = collectAuthorizedCompletionParentIds(
    working,
    originalSupportParentIds,
    [supportCommand],
    selectedLevel - 1,
    faceTolerance
  );

  const retryOptions: RefinementSessionPatchOptions = {
    ...resolvedOptions,
    rebuildExistingTransitions: compensation.mode !== "none"
  };
  delete retryOptions.activeBuild;
  delete retryOptions.transitionSupportCellIds;
  const rebuiltSupportPlan = buildCompletedRebuiltSupportPlan(
    working,
    rebuiltCoreParentIds,
    authorizedCompletionParentIds,
    [supportCommand.id],
    retryOptions
  );
  validateRebuiltSupportPlanOwnership(
    working,
    rebuiltSupportPlan.hiddenCellIds,
    originalSupportParentIds,
    [supportCommand],
    faceTolerance
  );
  const rebuiltSupportCommand = refineSessionPatchInternal(
    working,
    rebuiltSupportPlan.hiddenCellIds,
    retryOptions,
    TRANSACTION_REFINEMENT_SESSION_PATCH,
    rebuiltSupportPlan
  );
  const rebuiltSelectedCellsByGeometry = new Map<string, CellId>();
  for (const cellId of rebuiltSupportCommand.createdCellIds) {
    const cell = requiredCell(working, cellId);
    if (cell.level === selectedLevel && cell.role === "selected" && cell.active) {
      rebuiltSelectedCellsByGeometry.set(refinementCellGeometryKey(working, cell), cellId);
    }
  }
  const remappedCellIds = selectedGeometryKeys.map((key) => {
    const cellId = rebuiltSelectedCellsByGeometry.get(key);
    if (cellId === undefined) {
      throw new Error("automatic transition-shell rebuilding could not preserve the selected fine-cell geometry");
    }
    return cellId;
  });
  const currentRequestCommand = refineSessionPatchInternal(
    working,
    remappedCellIds,
    retryOptions,
    TRANSACTION_REFINEMENT_SESSION_PATCH
  );

  const createdCellIds = [...working.cells.keys()]
    .filter((cellId) => !originalCellIds.has(cellId))
    .sort(compareCellIds);
  const activeCreatedCellIds = createdCellIds.filter((cellId) => working.activeLeafIds.has(cellId));
  const reactivatedCellIds = [...working.activeLeafIds]
    .filter((cellId) => originalCellIds.has(cellId) && !originalActiveLeafIds.has(cellId))
    .sort(compareCellIds);
  const hiddenCellIds = [...originalActiveLeafIds]
    .filter((cellId) => !working.activeLeafIds.has(cellId))
    .sort(compareCellIds);
  const quality = session.kind === "H1"
    ? auditNetHexCellReplacementQuality(
        session,
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
    { length: working.nodes.length - originalNodeCount },
    (_, index) => originalNodeCount + index + 1
  );
  const twoToOne: TwoToOneCapabilityReport<CellId> = {
    status: "compensated",
    topologyClass: "mixed-level",
    originalSelectedCellIds: [...validation.cellIds].sort(compareCellIds),
    effectiveSelectedCellIds:
      activeSelectedCommandOutputCellIds(
        working,
        currentRequestCommand
      ),
    actions: [attemptedAction],
    affectedComponentCellIds: [...new Set([
      ...hiddenCellIds,
      ...activeCreatedCellIds,
      ...reactivatedCellIds
    ])].sort(compareCellIds),
    preservedFarFieldCellCount: originalActiveLeafIds.size - hiddenCellIds.length
  };
  const recipe = createRefinementSessionCommandRecipe(
    session,
    validation.cellIds,
    resolvedOptions
  );
  const command = freezeRefinementSessionCommand({
    id: compoundCommandId,
    kind: "refine",
    hiddenCellIds,
    createdCellIds,
    activeCreatedCellIds,
    reactivatedCellIds,
    createdNodeIds,
    ...(quality ? { quality } : {}),
    twoToOne,
    recipe
  }) as RefinementSessionCommand & {
    readonly twoToOne: ReadonlyTwoToOneCapabilityReport<CellId>;
  };
  working.undoStack = [...originalUndoStack, command];
  working.redoStack = [];
  working.nextCommandId = session.nextCommandId + 1;
  replaceRefinementSessionState(session, working);
  return command;
}

export function planRefinementSessionHistoryTransaction(
  session: RefinementSession,
  cellIds: readonly CellId[],
  resolvedOptions: ResolvedRefinementSessionPatchOptions,
  faceResolution: SessionFaceResolution
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
    &&
    supportDiscovery.component.supportCellIds.every((cellId) => {
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
      historyIndex
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
  const preliminaryCollisionWorking =
    cloneRefinementSession(session);
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
    findCollidingTransitionParentIds(
      preliminaryCollisionWorking,
      validation.cellIds,
      supportDiscovery.component.supportCellIds,
      validation.level,
      resolvedOptions,
      faceResolution.tolerance
    );
  const discovered = completeTransitionHistoryComponent(
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

  const working = cloneRefinementSession(session);
  const originalUndoStack = working.undoStack.slice();
  const originalActiveLeafIds = new Set(session.activeLeafIds);
  const originalCellIds = new Set(session.cells.keys());
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
    findCollidingTransitionParentIds(
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
      const parentId = requiredCell(working, cellId).parentId;
      if (parentId === undefined) {
        throw new Error(`supporting cell ${cellId} has no parent`);
      }
      return parentId;
    })
  );
  const previousCoreParentIds = stableCellIds(
    discovered.component.supportCellIds
      .filter((cellId) =>
        requiredCell(working, cellId).role === "selected"
      )
      .map((cellId) => requiredCell(working, cellId).parentId)
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
  const rebuiltSupportPlan = buildCompletedRebuiltSupportPlan(
    working,
    rebuiltCoreParentIds,
    authorizedCompletionParentIds,
    supportCommandIds,
    retryOptions
  );
  validateRebuiltSupportPlanOwnership(
    working,
    rebuiltSupportPlan.hiddenCellIds,
    originalSupportParentIds,
    supportCommands,
    faceResolution.tolerance
  );
  refineSessionPatchInternal(
    working,
    rebuiltSupportPlan.hiddenCellIds,
    retryOptions,
    TRANSACTION_REFINEMENT_SESSION_PATCH,
    rebuiltSupportPlan
  );

  const currentPlanningWorking = cloneRefinementSession(working);
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
    buildActiveRefinementGeometryIndex(
      currentPlanningWorking,
      faceResolution.tolerance
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
  const currentPatchPlan = buildRefinementSessionPatchPlan(
    currentPlanningWorking,
    preReplayRemappedCellIds,
    replaySessionPatchOptions(
      currentRecipe.options,
      preReplayTransitionSupportCellIds
    )
  );
  refineSessionPatchInternal(
    currentPlanningWorking,
    preReplayRemappedCellIds,
    replaySessionPatchOptions(
      currentRecipe.options,
      preReplayTransitionSupportCellIds
    ),
    TRANSACTION_REFINEMENT_SESSION_PATCH,
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
    const geometryIndex = buildActiveRefinementGeometryIndex(
      working,
      faceResolution.tolerance
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
    const replayedCommand = refineSessionPatchInternal(
      working,
      selectedCellIds,
      replaySessionPatchOptions(
        recipe.options,
        transitionSupportCellIds
      ),
      TRANSACTION_REFINEMENT_SESSION_PATCH
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
    buildActiveRefinementGeometryIndex(
      working,
      faceResolution.tolerance
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
  const currentRequestCommand = refineSessionPatchInternal(
    working,
    remappedCellIds,
    replaySessionPatchOptions(
      currentRecipe.options,
      remappedTransitionSupportCellIds
    ),
    TRANSACTION_REFINEMENT_SESSION_PATCH,
    rebaseRefinementSessionPatchPlan(
      working,
      currentPatchPlan,
      validation.level,
      replaySessionPatchOptions(
        currentRecipe.options,
        remappedTransitionSupportCellIds
      ),
      closureCommandIds
    )
  );

  const createdCellIds = [...working.cells.keys()]
    .filter((cellId) => !originalCellIds.has(cellId))
    .sort(compareCellIds);
  const activeCreatedCellIds = createdCellIds.filter((cellId) =>
    working.activeLeafIds.has(cellId)
  );
  const reactivatedCellIds = [...working.activeLeafIds]
    .filter((cellId) =>
      originalCellIds.has(cellId)
      && !originalActiveLeafIds.has(cellId)
    )
    .sort(compareCellIds);
  const hiddenCellIds = [...originalActiveLeafIds]
    .filter((cellId) => !working.activeLeafIds.has(cellId))
    .sort(compareCellIds);
  const quality = session.kind === "H1"
    ? auditNetHexCellReplacementQuality(
        session,
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
    { length: working.nodes.length - originalNodeCount },
    (_, index) => originalNodeCount + index + 1
  );
  const effectiveSelectedCellIds =
    activeSelectedCommandOutputCellIds(
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
      originalActiveLeafIds.size - hiddenCellIds.length
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
  working.undoStack = [...originalUndoStack, command];
  working.redoStack = [];
  working.nextCommandId = session.nextCommandId + 1;
  working.revision = session.revision + 1;

  const finalActive = buildActiveMeshWithMap(working, {
    mergeNodes: true,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false,
    ...(faceResolution.mergeTolerance === undefined
      ? {}
      : { mergeTolerance: faceResolution.mergeTolerance })
  });
  const conformance = checkNoHangingNodes(
    finalActive.mesh,
    faceResolution.tolerance
  );
  if (!conformance.ok) {
    throw freezeTwoToOnePlanningErrorDiagnostic(
      new TwoToOnePlanningError<CellId>(
        "TWO_TO_ONE_CONFORMANCE",
        `history transaction final mesh is nonconforming: ${
          conformance.hanging[0]?.message
          ?? `${conformance.unmatchedInteriorBoundaryCount} unmatched interior boundaries`
        }`,
        {
          conflictingCellIds: stableCellIds(validation.cellIds),
          conflictingInterfaces: [],
          attemptedActions: [attemptedAction],
          suggestion: {
            kind: "expand-selection"
          }
        }
      )
    );
  }
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
      outputElementCount: finalActive.mesh.elements.length
    },
    twoToOne: cloneTwoToOneCapabilityReport(twoToOne),
    ...(quality === undefined ? {} : { quality })
  };
  return {
    historyClosure,
    command,
    finalSession: working,
    preview
  };
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

function planUntouchedTransitionShellHistoryTransaction(
  session: RefinementSession,
  cellIds: readonly CellId[],
  resolvedOptions: ResolvedRefinementSessionPatchOptions,
  faceResolution: SessionFaceResolution,
  discovered: DiscoveredTransitionHistoryComponent,
  historyIndex: RefinementHistoryIndex
): RefinementSessionHistoryTransactionPlan {
  const supportCommand = discovered.supportCommands[0];
  if (
    supportCommand === undefined
    || discovered.supportCommands.length !== 1
  ) {
    throw new Error(
      "untouched transition-shell planning requires one supporting root command"
    );
  }
  const working = cloneRefinementSession(session);
  const command = refineSessionPatchWithRebuiltTransitionShell(
    working,
    [...cellIds],
    resolvedOptions,
    faceResolution
  );
  const finalActive = buildActiveMeshWithMap(working, {
    mergeNodes: true,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false,
    ...(faceResolution.mergeTolerance === undefined
      ? {}
      : { mergeTolerance: faceResolution.mergeTolerance })
  });
  const inputElementCount =
    resolvedOptions.activeBuild.mesh.elements.length;
  const affectedInputCellIds =
    traceLocalSupportCommandInputCellIds(
      session,
      supportCommand,
      discovered.component.supportCellIds
    );
  const includedCommandIds = new Set([
    supportCommand.id
  ]);
  const boundaryCellIds = affectedInputCellIds.filter((cellId) => {
    const creatorCommandId =
      historyIndex.creatorCommandIdByCellId.get(cellId);
    return creatorCommandId === undefined
      || !includedCommandIds.has(creatorCommandId);
  });
  const historyClosure: RefinementHistoryClosure = Object.freeze({
    supportCommandIds: Object.freeze([
      supportCommand.id
    ]),
    downstreamCommandIds: Object.freeze([]),
    affectedInputCellIds: Object.freeze(affectedInputCellIds),
    preservedCommandIds: Object.freeze(
      session.undoStack
        .filter((entry) =>
          entry.id !== supportCommand.id
        )
        .map((entry) => entry.id)
    ),
    boundaryCellIds: Object.freeze(boundaryCellIds)
  });
  const preview: RefinementPreview<CellId> = {
    kind: session.kind,
    planMode: "aggregate",
    plan: [],
    compound: {
      kind: "transition-shell-rebuild"
    },
    summary: {
      inputElementCount,
      changedInputElementCount: command.hiddenCellIds.length,
      preservedInputElementCount:
        inputElementCount - command.hiddenCellIds.length,
      outputElementCount: finalActive.mesh.elements.length
    },
    twoToOne:
      cloneTwoToOneCapabilityReport(command.twoToOne),
    ...(command.quality === undefined
      ? {}
      : { quality: command.quality })
  };
  return {
    historyClosure,
    command,
    finalSession: working,
    preview
  };
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

function reverseRefinementHistoryCommands(
  session: RefinementSession,
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
    for (
      const cellId of
        command.activeCreatedCellIds ?? command.createdCellIds
    ) {
      const cell = requiredCell(session, cellId);
      cell.active = false;
      cell.hidden = true;
      removeActiveLeafCellId(session, cellId);
    }
    for (const cellId of command.reactivatedCellIds ?? []) {
      const cell = requiredCell(session, cellId);
      cell.active = false;
      cell.hidden = true;
      removeActiveLeafCellId(session, cellId);
    }
    for (const cellId of command.hiddenCellIds) {
      const cell = requiredCell(session, cellId);
      cell.active = true;
      cell.hidden = false;
      addActiveLeafCellId(session, cellId);
    }
    assertActivatedRefinementSessionCellsHaveNoActiveRelations(
      session,
      command.hiddenCellIds
    );
  }
}

export function assertActivatedRefinementSessionCellsHaveNoActiveRelations(
  session: Pick<RefinementSession, "cells">,
  activatedCellIds: readonly CellId[]
): void {
  const visitedAncestorIds = new Set<CellId>();
  const visitedDescendantIds = new Set<CellId>();
  for (const activatedCellId of new Set(activatedCellIds)) {
    const activatedCell = requiredHierarchyCell(
      session,
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
      const ancestor = requiredHierarchyCell(session, ancestorId);
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
        session,
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
  session: Pick<RefinementSession, "cells">,
  cellId: CellId
): RefinementSessionCell {
  const cell = session.cells.get(cellId);
  if (cell === undefined) {
    throw new Error(`unknown refinement cell ${cellId}`);
  }
  return cell;
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
  plan: RefinementSessionPatchPlan,
  level: number,
  options: RefinementSessionPatchOptions,
  historyCommandIds: readonly string[]
): RefinementSessionPatchPlan {
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
  return {
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
  };
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
): RefinementSessionPatchPlan {
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

function cloneRefinementSession(session: RefinementSession): MutableRefinementSession {
  const clonedExtras = cloneEnumerableExtraProperties(
    session,
    REFINEMENT_SESSION_STATE_KEYS
  );
  return {
    ...clonedExtras,
    revision: session.revision,
    baseMesh: cloneMesh(session.baseMesh),
    kind: session.kind,
    nodes: session.nodes.map((point) => [...point]),
    cells: new Map([...session.cells].map(([cellId, cell]) => [cellId, {
      ...cell,
      element: [...cell.element],
      children: [...cell.children]
    }])),
    activeLeafIds: new Set(session.activeLeafIds),
    sortedActiveLeafIds: [...session.sortedActiveLeafIds],
    sortedActiveLeafIdsDirty: session.sortedActiveLeafIdsDirty,
    activeLeafIdsByNodeKey: new Map([...session.activeLeafIdsByNodeKey].map(([key, ownerIds]) => [
      key,
      [...ownerIds]
    ])),
    undoStack: session.undoStack.map(cloneRefinementSessionCommand),
    redoStack: session.redoStack.map(cloneRefinementSessionCommand),
    nextCommandId: session.nextCommandId,
    nextCellOrdinal: session.nextCellOrdinal
  } as MutableRefinementSession;
}

const REFINEMENT_SESSION_STATE_KEYS = new Set([
  "revision",
  "baseMesh",
  "kind",
  "nodes",
  "cells",
  "activeLeafIds",
  "sortedActiveLeafIds",
  "sortedActiveLeafIdsDirty",
  "activeLeafIdsByNodeKey",
  "undoStack",
  "redoStack",
  "nextCommandId",
  "nextCellOrdinal"
]);

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

function replaceRefinementSessionState(
  target: RefinementSession,
  source: RefinementSession
): void {
  const mutableTarget = mutableRefinementSession(target);
  const mutableSource = mutableRefinementSession(source);
  const nextRevision = mutableTarget.revision + 1;
  mutableTarget.baseMesh = mutableSource.baseMesh;
  mutableTarget.kind = mutableSource.kind;
  mutableTarget.nodes = mutableSource.nodes;
  mutableTarget.cells = mutableSource.cells;
  mutableTarget.activeLeafIds = mutableSource.activeLeafIds;
  mutableTarget.sortedActiveLeafIds = mutableSource.sortedActiveLeafIds;
  mutableTarget.sortedActiveLeafIdsDirty = mutableSource.sortedActiveLeafIdsDirty;
  mutableTarget.activeLeafIdsByNodeKey = mutableSource.activeLeafIdsByNodeKey;
  mutableTarget.undoStack = mutableSource.undoStack;
  mutableTarget.redoStack = mutableSource.redoStack;
  mutableTarget.nextCommandId = mutableSource.nextCommandId;
  mutableTarget.nextCellOrdinal = mutableSource.nextCellOrdinal;
  mutableTarget.revision = nextRevision;
}

export function previewSessionPatch(
  session: RefinementSession,
  cellIds: CellId[],
  options: RefinementSessionPatchOptions = {}
): RefinementPreview<CellId> {
  const resolvedOptions = resolveSessionPatchOptions(session, cellIds, options);
  const sourceActive = resolvedOptions.activeBuild;
  try {
    let patch: RefinementSessionPatchPlan;
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

function buildRefinementSessionPatchPlan(
  session: RefinementSession,
  cellIds: CellId[],
  options: RefinementSessionPatchOptions
): RefinementSessionPatchPlan {
  const validation = validateRefinementSessionSelection(session, cellIds);
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }

  const usesSameLevelPlanning = options.hexRefinementRatio === 2
    && options.hexTwoToOneSelectionMode === "local"
    && validation.level !== undefined
    && validation.level > 0;
  const sourceActive = options.activeBuild ?? (usesSameLevelPlanning
    ? buildActiveMeshWithMap(session, {
        mergeNodes: true,
        includeSessionNodeIdByNodeId: false,
        includeSessionNodeIdsByNodeId: false,
        ...(options.mergeTolerance !== undefined ? { mergeTolerance: options.mergeTolerance } : {})
      })
    : buildRefinementPatchActiveMesh(session, validation.cellIds, options));
  const active = usesSameLevelPlanning
    ? buildSameLevelRefinementPlanningMesh(session, validation.level!, options)
    : sourceActive;
  const selectedElementIds = validation.cellIds
    .map((cellId) => activeBuildElementIdByCellId(session, active, cellId))
    .filter((elementId): elementId is number => elementId !== undefined);
  if (selectedElementIds.length !== validation.cellIds.length) {
    throw new Error("refinement selection contains cells outside the active mesh");
  }
  const transitionSupportCellIds = stableCellIds(
    options.transitionSupportCellIds ?? []
  );
  const transitionSupportElementIds =
    transitionSupportCellIds.map((cellId) =>
      activeBuildElementIdByCellId(session, active, cellId)
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
  const replacementParentIds = replacementParentCellIds(active, replacements);
  assertActiveBuildCoversSessionCells(session, active, replacementParentIds);
  if (active !== sourceActive) {
    assertActiveBuildCoversSessionCells(session, sourceActive, replacementParentIds);
  }
  const parentIds = new Set<CellId>();
  for (let index = 0; index < replacements.length; index += 1) {
    const replacement = replacements[index]!;
    const parentId = replacementParentIds[index]!;
    const parent = requiredCell(session, parentId);
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
    : mapPlanningReplacementsToSource(session, sourceActive, active, replacements);
  if (usesSameLevelPlanning) {
    validateSameLevelPlanningConformance(
      sourceActive,
      sourceReplacements,
      options.mergeTolerance
    );
  }
  const quality = session.kind === "H1" && sourceReplacements.length > 0
    ? assertHexPatchQuality(mutableMeshView(sourceActive.mesh), sourceReplacements)
    : undefined;
  const twoToOne = classifiedPlan.twoToOne
    ? mapTwoToOneReportToCellIds(
        active,
        classifiedPlan.twoToOne,
        session.activeLeafIds.size
      )
    : undefined;
  const recipe = createRefinementSessionCommandRecipe(
    session,
    validation.cellIds,
    options
  );

  return {
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
  };
}

function createRefinementSessionCommandRecipe(
  session: RefinementSession,
  selectedCellIds: readonly CellId[],
  options: RefinementSessionPatchOptions
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
      refinementCellGeometrySnapshot(session, cellId)
    ),
    transitionSupportCellIds: stableTransitionSupportCellIds,
    transitionSupportCellGeometry:
      stableTransitionSupportCellIds.map((cellId) =>
        refinementCellGeometrySnapshot(session, cellId)
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

function assertRefinementSessionPatchPlanParents(
  session: RefinementSession,
  plan: RefinementSessionPatchPlan
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
  const command = mutable.undoStack.pop();
  if (!command) {
    return undefined;
  }
  for (const cellId of command.createdCellIds) {
    const cell = requiredCell(session, cellId);
    cell.active = false;
    cell.hidden = true;
    removeActiveLeafCellId(session, cellId);
  }
  for (const cellId of command.reactivatedCellIds ?? []) {
    const cell = requiredCell(session, cellId);
    cell.active = false;
    cell.hidden = true;
    removeActiveLeafCellId(session, cellId);
  }
  for (const cellId of command.hiddenCellIds) {
    const cell = requiredCell(session, cellId);
    cell.active = true;
    cell.hidden = false;
    addActiveLeafCellId(session, cellId);
  }
  mutable.redoStack.push(command);
  mutable.revision += 1;
  return command;
}

export function redoRefinementSession(session: RefinementSession): RefinementSessionCommand | undefined {
  const mutable = mutableRefinementSession(session);
  const command = mutable.redoStack.pop();
  if (!command) {
    return undefined;
  }
  for (const cellId of command.hiddenCellIds) {
    const cell = requiredCell(session, cellId);
    cell.active = false;
    cell.hidden = true;
    removeActiveLeafCellId(session, cellId);
  }
  for (const cellId of command.activeCreatedCellIds ?? command.createdCellIds) {
    const cell = requiredCell(session, cellId);
    cell.active = true;
    cell.hidden = false;
    addActiveLeafCellId(session, cellId);
  }
  for (const cellId of command.reactivatedCellIds ?? []) {
    const cell = requiredCell(session, cellId);
    cell.active = true;
    cell.hidden = false;
    addActiveLeafCellId(session, cellId);
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

function addActiveLeafCellId(session: RefinementSession, cellId: CellId): void {
  const mutable = mutableRefinementSession(session);
  if (session.activeLeafIds.has(cellId)) {
    return;
  }
  const cell = requiredCell(session, cellId);
  mutable.activeLeafIds.add(cellId);
  mutable.sortedActiveLeafIdsDirty = true;
  for (const sessionNodeId of cell.element) {
    const point = session.nodes[sessionNodeId - 1];
    if (!point) {
      throw new Error(`active cell ${cellId} references missing node ${sessionNodeId}`);
    }
    const key = exactActiveMergeKey(point);
    const ownerIds = mutable.activeLeafIdsByNodeKey.get(key) ?? [];
    ownerIds.push(cellId);
    mutable.activeLeafIdsByNodeKey.set(key, ownerIds);
  }
}

function removeActiveLeafCellId(session: RefinementSession, cellId: CellId): void {
  const mutable = mutableRefinementSession(session);
  const cell = requiredCell(session, cellId);
  if (!mutable.activeLeafIds.delete(cellId)) {
    return;
  }
  mutable.sortedActiveLeafIdsDirty = true;
  for (const sessionNodeId of cell.element) {
    const point = session.nodes[sessionNodeId - 1];
    if (!point) {
      throw new Error(`active cell ${cellId} references missing node ${sessionNodeId}`);
    }
    const key = exactActiveMergeKey(point);
    const ownerIds = mutable.activeLeafIdsByNodeKey.get(key);
    if (!ownerIds) {
      continue;
    }
    const nextOwnerIds = ownerIds.filter((ownerId) => ownerId !== cellId);
    if (nextOwnerIds.length === 0) {
      mutable.activeLeafIdsByNodeKey.delete(key);
    } else {
      mutable.activeLeafIdsByNodeKey.set(key, nextOwnerIds);
    }
  }
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
