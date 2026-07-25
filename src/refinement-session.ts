import type {
  Element,
  ElementKind,
  HexRefinementQualitySummary,
  LocalRefinement,
  Mesh,
  Point,
  RefinementPreview,
  RefinementRole
} from "./types.js";
import {
  elementVertices,
  inferMeshKind,
  mergeCoincidentNodesWithMap,
  minElementEdgeLength,
  replaceElements
} from "./mesh.js";
import {
  buildDefaultRefinementPlan,
  type ClassifiedReplacement
} from "./refinement-planner.js";
import { checkNoHangingNodes, type ConformanceReport } from "./conformance.js";
import {
  auditHexRefinementPatchQuality,
  auditHexRefinementQuality,
  hexElementSignedVolume,
  minimumOrientedHexCornerScaledJacobian
} from "./hex-quality.js";
import { inferHexElementLattice } from "./regularization.js";
import { H1_FACES } from "./topology.js";
import {
  cloneTwoToOneCapabilityReport,
  DirectTwoToOnePlanningError,
  type TwoToOneCapabilityReport
} from "./two-to-one-capability.js";

export type CellId = string;
export type RefinementSessionCellRole = "base" | RefinementRole;

export interface RefinementSessionCell {
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

export interface RefinementSessionCommand {
  id: string;
  kind: "refine";
  hiddenCellIds: CellId[];
  createdCellIds: CellId[];
  activeCreatedCellIds?: CellId[];
  reactivatedCellIds?: CellId[];
  createdNodeIds: number[];
  quality?: HexRefinementQualitySummary;
  twoToOne?: TwoToOneCapabilityReport<CellId>;
}

export interface RefinementSession {
  baseMesh: Mesh;
  kind: ElementKind;
  nodes: Point[];
  cells: Map<CellId, RefinementSessionCell>;
  activeLeafIds: Set<CellId>;
  sortedActiveLeafIds: CellId[];
  sortedActiveLeafIdsDirty: boolean;
  activeLeafIdsByNodeKey: Map<string, CellId[]>;
  undoStack: RefinementSessionCommand[];
  redoStack: RefinementSessionCommand[];
  nextCommandId: number;
  nextCellOrdinal: number;
}

const cellIdPartsCache = new Map<CellId, number[]>();

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
  mesh: Mesh;
  cellIdByElementId: Map<number, CellId>;
  elementIdByCellId: Map<CellId, number>;
  cellIdsByElementIdArray?: CellId[];
  elementIdByCellOrdinalArray?: Int32Array;
  nodeIdBySessionNodeId: Map<number, number>;
  sessionNodeIdByNodeId: Map<number, number>;
  sessionNodeIdsByNodeId: Map<number, number[]>;
  elementIdsByNodeId?: Map<number, number[]>;
}

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
  mesh: Mesh;
  build: ActiveMeshBuildResult;
  sets: ActiveMeshSetRemapResult;
}

export interface RefinementSessionLocalConformanceReport {
  report: ConformanceReport;
  mesh: Mesh;
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
  /**
   * Rebuild one untouched supporting 2:1 shell when a nested local patch
   * reaches it. Set false to preserve strict collision rejection.
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
}

export function createRefinementSession(mesh: Mesh): RefinementSession {
  const kind = inferMeshKind(mesh);
  const cells = new Map<CellId, RefinementSessionCell>();
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

export function buildActiveMesh(session: RefinementSession, options: BuildActiveMeshOptions = {}): Mesh {
  return buildActiveMeshWithMap(session, options).mesh;
}

export function buildActiveMeshWithMap(
  session: RefinementSession,
  options: BuildActiveMeshOptions = {}
): ActiveMeshBuildResult {
  return buildActiveMeshForCellIdsWithMap(session, sortedActiveLeafIds(session), options);
}

function buildActiveMeshForCellIdsWithMap(
  session: RefinementSession,
  activeIds: readonly CellId[],
  options: BuildActiveMeshOptions = {}
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
      includeElementIdByCellId
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
    nodes.push(node);
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
    if (cell.ordinal < elementIdByCellOrdinalArray.length) {
      elementIdByCellOrdinalArray[cell.ordinal] = elementId;
    }
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
      result.elementIdsByNodeId = buildElementIdsByNodeId(mesh.elements);
    }
    return result;
  }

  const mergeTolerance = options.mergeTolerance ?? minElementEdgeLength(mesh) * 0.0005;
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
    result.elementIdsByNodeId = buildElementIdsByNodeId(merged.mesh.elements);
  }
  return result;
}

function buildMergedActiveMeshDirect(
  session: RefinementSession,
  activeIds: readonly CellId[],
  options: BuildActiveMeshOptions,
  includeSessionNodeIdByNodeId: boolean,
  includeSessionNodeIdsByNodeId: boolean,
  includeCellIdByElementId: boolean,
  includeElementIdByCellId: boolean
): ActiveMeshBuildResult {
  const tolerance = options.mergeTolerance!;
  const toleranceSquared = tolerance * tolerance;
  const sessionNodes = session.nodes;
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
  const buckets = tolerance === 0 ? undefined : new Map<number, number[]>();

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
    if (cell.ordinal < elementIdByCellOrdinalArray.length) {
      elementIdByCellOrdinalArray[cell.ordinal] = elementId;
    }
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
          nodeIndex = exactNodeIndexByKey.get(exactKey);
          if (nodeIndex === undefined) {
            nodeIndex = nodes.length;
            nodes.push(point);
            exactNodeIndexByKey.set(exactKey, nodeIndex);
          }
        } else if (buckets) {
          nodeIndex = findMergedActiveNodeIndex(point, nodes, buckets, tolerance, toleranceSquared);
          if (nodeIndex === undefined) {
            nodeIndex = nodes.length;
            nodes.push(point);
            addActiveMergeBucket(point, nodeIndex, buckets, tolerance);
          }
        } else {
          nodeIndex = nodes.length;
          nodes.push(point);
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
    result.elementIdsByNodeId = buildElementIdsByNodeId(elements);
  }
  return result;
}

function findMergedActiveNodeIndex(
  point: Point,
  nodes: readonly Point[],
  buckets: ReadonlyMap<number, readonly number[]>,
  tolerance: number,
  toleranceSquared: number
): number | undefined {
  let bestIndex: number | undefined;
  const px = point[0] ?? 0;
  const py = point[1] ?? 0;
  const pz = point[2] ?? 0;
  const i = Math.floor(px / tolerance);
  const j = Math.floor(py / tolerance);
  const k = Math.floor(pz / tolerance);
  if (point.length <= 2) {
    for (let di = -1; di <= 1; di += 1) {
      for (let dj = -1; dj <= 1; dj += 1) {
        for (const candidateIndex of buckets.get(activeMergeBucketHash2(i + di, j + dj)) ?? []) {
          if (bestIndex !== undefined && candidateIndex >= bestIndex) {
            continue;
          }
          const candidate = nodes[candidateIndex]!;
          const dx = (candidate[0] ?? 0) - px;
          const dy = (candidate[1] ?? 0) - py;
          if ((dx * dx) + (dy * dy) <= toleranceSquared) {
            bestIndex = candidateIndex;
          }
        }
      }
    }
    return bestIndex;
  }
  for (let di = -1; di <= 1; di += 1) {
    for (let dj = -1; dj <= 1; dj += 1) {
      for (let dk = -1; dk <= 1; dk += 1) {
        for (const candidateIndex of buckets.get(activeMergeBucketHash3(i + di, j + dj, k + dk)) ?? []) {
          if (bestIndex !== undefined && candidateIndex >= bestIndex) {
            continue;
          }
          const candidate = nodes[candidateIndex]!;
          const dx = (candidate[0] ?? 0) - px;
          const dy = (candidate[1] ?? 0) - py;
          const dz = (candidate[2] ?? 0) - pz;
          if ((dx * dx) + (dy * dy) + (dz * dz) <= toleranceSquared) {
            bestIndex = candidateIndex;
          }
        }
      }
    }
  }
  return bestIndex;
}

function addActiveMergeBucket(
  point: Point,
  nodeIndex: number,
  buckets: Map<number, number[]>,
  tolerance: number
): void {
  const key = activeMergeBucketKey(point, tolerance);
  const bucket = buckets.get(key) ?? [];
  bucket.push(nodeIndex);
  buckets.set(key, bucket);
}

function forEachActiveMergeCandidateKey(point: Point, tolerance: number, visit: (key: number) => void): void {
  const i = Math.floor((point[0] ?? 0) / tolerance);
  const j = Math.floor((point[1] ?? 0) / tolerance);
  const k = Math.floor((point[2] ?? 0) / tolerance);
  if (point.length <= 2) {
    for (let di = -1; di <= 1; di += 1) {
      for (let dj = -1; dj <= 1; dj += 1) {
        visit(activeMergeBucketHash2(i + di, j + dj));
      }
    }
    return;
  }
  for (let di = -1; di <= 1; di += 1) {
    for (let dj = -1; dj <= 1; dj += 1) {
      for (let dk = -1; dk <= 1; dk += 1) {
        visit(activeMergeBucketHash3(i + di, j + dj, k + dk));
      }
    }
  }
}

function activeMergeBucketKey(point: Point, tolerance: number): number {
  const i = Math.floor((point[0] ?? 0) / tolerance);
  const j = Math.floor((point[1] ?? 0) / tolerance);
  if (point.length <= 2) {
    return activeMergeBucketHash2(i, j);
  }
  return activeMergeBucketHash3(i, j, Math.floor((point[2] ?? 0) / tolerance));
}

function activeMergeBucketHash2(i: number, j: number): number {
  return i * 73856093 + j * 19349663;
}

function activeMergeBucketHash3(i: number, j: number, k: number): number {
  return i * 73856093 + j * 19349663 + k * 83492791;
}

function exactActiveMergeKey(point: Point): string {
  return point.length <= 2
    ? `${point[0] ?? 0}:${point[1] ?? 0}`
    : `${point[0] ?? 0}:${point[1] ?? 0}:${point[2] ?? 0}`;
}

export function activeBuildCellIdByElementId(build: ActiveMeshBuildResult, elementId: number): CellId | undefined {
  return build.cellIdsByElementIdArray?.[elementId] ?? build.cellIdByElementId.get(elementId);
}

export function activeBuildElementIdByCellId(
  session: RefinementSession,
  build: ActiveMeshBuildResult,
  cellId: CellId
): number | undefined {
  const ordinal = session.cells.get(cellId)?.ordinal;
  if (ordinal !== undefined) {
    const elementId = build.elementIdByCellOrdinalArray?.[ordinal];
    if (elementId) {
      return elementId;
    }
  }
  return build.elementIdByCellId.get(cellId);
}

export function remapSessionSetsToActiveMesh(
  build: ActiveMeshBuildResult,
  sets: RefinementSessionSetRemapInput
): ActiveMeshSetRemapResult {
  const cellSets = new Map<string, number[]>();
  const nodeSets = new Map<string, number[]>();
  const missingCellIdsBySet = new Map<string, CellId[]>();
  const missingNodeIdsBySet = new Map<string, number[]>();

  for (const [name, cellIds] of namedSetEntries(sets.cellSets)) {
    const elementIds: number[] = [];
    const missingCellIds: CellId[] = [];
    for (const cellId of uniquePreserveOrder(cellIds)) {
      const elementId = build.elementIdByCellId.get(cellId);
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
      const nodeId = build.nodeIdBySessionNodeId.get(sessionNodeId);
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
  const seedElementIds = command.createdCellIds
    .map((cellId) => activeBuildElementIdByCellId(session, active, cellId))
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
          nodes: session.nodes,
          elements: planned.map(({ parent }) => parent.element)
        },
        planned.map(({ refinement }, index) => ({
          elementId: index + 1,
          refinement
        }))
      )
    : undefined;
  const createdCellIds: CellId[] = [];
  const createdNodeIds: number[] = [];
  const hiddenCellIds: CellId[] = [];

  for (const { parentId, parent, refinement } of planned) {
    const nodeOffset = session.nodes.length;
    for (const [index, point] of refinement.nodes.entries()) {
      session.nodes.push([...point]);
      createdNodeIds.push(nodeOffset + index + 1);
    }

    const parentCreatedCellIds: CellId[] = [];
    const firstChildIndex = parent.children.length + 1;
    refinement.elements.forEach((element, index) => {
      const childId = `${parentId}/${firstChildIndex + index}`;
      parentCreatedCellIds.push(childId);
      createdCellIds.push(childId);
      const child: RefinementSessionCell = {
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
      session.cells.set(childId, child);
      addActiveLeafCellId(session, childId);
    });

    parent.children.push(...parentCreatedCellIds);
    parent.active = false;
    parent.hidden = true;
    removeActiveLeafCellId(session, parentId);
    hiddenCellIds.push(parentId);
  }

  const command: RefinementSessionCommand = {
    id: `cmd-${session.nextCommandId}`,
    kind: "refine",
    hiddenCellIds,
    createdCellIds,
    createdNodeIds,
    ...(quality ? { quality } : {})
  };
  session.nextCommandId += 1;
  session.undoStack.push(command);
  session.redoStack = [];
  return command;
}

export function refineSessionPatch(
  session: RefinementSession,
  cellIds: CellId[],
  options: RefinementSessionPatchOptions = {}
): RefinementSessionCommand {
  let plan: RefinementSessionPatchPlan;
  try {
    plan = buildRefinementSessionPatchPlan(session, cellIds, options);
  } catch (error) {
    if (shouldRebuildExistingTransitionShell(session, cellIds, options, error)) {
      return refineSessionPatchWithRebuiltTransitionShell(session, cellIds, options);
    }
    throw error;
  }
  return applyRefinementSessionPatchPlan(session, plan);
}

function applyRefinementSessionPatchPlan(
  session: RefinementSession,
  plan: RefinementSessionPatchPlan
): RefinementSessionCommand {
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
    const nodeOffset = session.nodes.length;
    for (const [index, point] of replacement.refinement.nodes.entries()) {
      session.nodes.push([...point]);
      createdNodeIds.push(nodeOffset + index + 1);
    }

    const parentCreatedCellIds: CellId[] = [];
    const firstChildIndex = parent.children.length + 1;
    replacement.refinement.elements.forEach((element, index) => {
      const childId = `${parentId}/${firstChildIndex + index}`;
      parentCreatedCellIds.push(childId);
      createdCellIds.push(childId);
      const child: RefinementSessionCell = {
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
      session.cells.set(childId, child);
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

  const command: RefinementSessionCommand = {
    id: `cmd-${session.nextCommandId}`,
    kind: "refine",
    hiddenCellIds,
    createdCellIds,
    createdNodeIds,
    ...(plan.quality ? { quality: plan.quality } : {}),
    ...(plan.twoToOne
      ? { twoToOne: cloneTwoToOneCapabilityReport(plan.twoToOne) }
      : {})
  };
  session.nextCommandId += 1;
  session.undoStack.push(command);
  session.redoStack = [];
  return command;
}

const EXISTING_TRANSITION_COLLISION_ERROR =
  "second-level local 2:1 refinement would create a nonconforming interface with an existing transition layer";

class ExistingTransitionCollisionError extends Error {
  readonly code = "EXISTING_TRANSITION_COLLISION";
}

class HexPatchQualityError extends Error {
  constructor(
    readonly code:
      | "HEX_PATCH_PARENT_JACOBIAN"
      | "HEX_PATCH_CHILD_JACOBIAN"
      | "HEX_PATCH_VOLUME",
    message: string
  ) {
    super(message);
  }
}

function shouldRebuildExistingTransitionShell(
  session: RefinementSession,
  cellIds: readonly CellId[],
  options: RefinementSessionPatchOptions,
  error: unknown
): boolean {
  if (
    options.rebuildExistingTransitions === false
    || options.hexRefinementRatio !== 2
    || options.hexTwoToOneSelectionMode !== "local"
    || !(error instanceof Error)
  ) {
    return false;
  }
  const validation = validateRefinementSessionSelection(session, [...cellIds]);
  if (!validation.ok || validation.level === undefined || validation.level < 1) {
    return false;
  }
  return error instanceof ExistingTransitionCollisionError
    || (
      error instanceof HexPatchQualityError
      && error.code === "HEX_PATCH_VOLUME"
      && selectionTouchesActiveTransitionCell(
        session,
        validation.cellIds,
        validation.level
      )
    );
}

function selectionTouchesActiveTransitionCell(
  session: RefinementSession,
  selectedCellIds: readonly CellId[],
  level: number
): boolean {
  const selectedFaceKeys = new Set(selectedCellIds.flatMap((cellId) =>
    refinementCellFaceKeys(session, requiredCell(session, cellId))
  ));
  for (const cellId of session.activeLeafIds) {
    const cell = requiredCell(session, cellId);
    if (
      cell.level === level
      && isTransitionSessionCell(cell)
      && refinementCellFaceKeys(session, cell).some((key) => selectedFaceKeys.has(key))
    ) {
      return true;
    }
  }
  return false;
}

function refineSessionPatchWithRebuiltTransitionShell(
  session: RefinementSession,
  cellIds: readonly CellId[],
  options: RefinementSessionPatchOptions
): RefinementSessionCommand & { twoToOne: TwoToOneCapabilityReport<CellId> } {
  const working = cloneRefinementSession(session);
  const validation = validateRefinementSessionSelection(working, [...cellIds]);
  if (!validation.ok || validation.level === undefined || validation.level < 1) {
    throw new Error(validation.errors.join("; ") || "transition-shell rebuilding requires a refined selection");
  }
  const selectedLevel = validation.level;
  const supportCommand = findSingleSupportCommand(working, validation.cellIds);
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
    validation.cellIds
  );
  const collidingTransitionParentIds = findCollidingTransitionParentIds(
    working,
    validation.cellIds,
    supportLayerCellIds,
    selectedLevel,
    options
  );
  if (collidingTransitionParentIds.length === 0) {
    throw new Error("automatic transition-shell rebuilding could not isolate the colliding transition parents");
  }
  const nonLeafSupportCellIds = supportLayerCellIds.filter((cellId) => {
    const cell = requiredCell(working, cellId);
    return !cell.active || cell.hidden || !working.activeLeafIds.has(cellId);
  });
  if (nonLeafSupportCellIds.length > 0) {
    throw new Error(
      `automatic transition-shell rebuilding requires an untouched supporting layer: ${nonLeafSupportCellIds.join(", ")}`
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
    supportCommand,
    selectedLevel - 1
  );

  const retryOptions: RefinementSessionPatchOptions = {
    ...options,
    rebuildExistingTransitions: false
  };
  delete retryOptions.activeBuild;
  delete retryOptions.transitionSupportCellIds;
  const rebuiltSupportPlan = buildCompletedRebuiltSupportPlan(
    working,
    rebuiltCoreParentIds,
    authorizedCompletionParentIds,
    retryOptions
  );
  validateRebuiltSupportPlanOwnership(
    working,
    rebuiltSupportPlan.hiddenCellIds,
    originalSupportParentIds,
    supportCommand
  );
  const rebuiltSupportCommand = applyRefinementSessionPatchPlan(
    working,
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
  refineSessionPatch(working, remappedCellIds, retryOptions);

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
  if (quality && !quality.ok) {
    throw new Error(
      "automatic transition-shell rebuilding failed its net quality gate: " +
      `parent minimum Jacobian ${quality.parentMinimumOrientedScaledJacobian}, ` +
      `child minimum Jacobian ${quality.childMinimumOrientedScaledJacobian}, ` +
      `relative volume error ${quality.relativeVolumeError}`
    );
  }
  const createdNodeIds = Array.from(
    { length: working.nodes.length - originalNodeCount },
    (_, index) => originalNodeCount + index + 1
  );
  const previousCoreParentIdSet = new Set(previousCoreParentIds);
  const twoToOne: TwoToOneCapabilityReport<CellId> = {
    status: "compensated",
    topologyClass: "mixed-level",
    originalSelectedCellIds: [...validation.cellIds].sort(compareCellIds),
    effectiveSelectedCellIds: [...remappedCellIds].sort(compareCellIds),
    actions: [{
      kind: "transition-shell-rebuild",
      reason: "the nested core reached an existing 2:1 transition component",
      addedParentCellIds: rebuiltCoreParentIds
        .filter((cellId) => !previousCoreParentIdSet.has(cellId)),
      replacedTransitionCellIds: [...collidingTransitionParentIds]
    }],
    affectedComponentCellIds: [...new Set([
      ...hiddenCellIds,
      ...activeCreatedCellIds,
      ...reactivatedCellIds
    ])].sort(compareCellIds),
    preservedFarFieldCellCount: originalActiveLeafIds.size - hiddenCellIds.length
  };
  const command: RefinementSessionCommand & {
    twoToOne: TwoToOneCapabilityReport<CellId>;
  } = {
    id: compoundCommandId,
    kind: "refine",
    hiddenCellIds,
    createdCellIds,
    activeCreatedCellIds,
    reactivatedCellIds,
    createdNodeIds,
    ...(quality ? { quality } : {}),
    twoToOne
  };
  working.undoStack = [...originalUndoStack, command];
  working.redoStack = [];
  working.nextCommandId = session.nextCommandId + 1;
  replaceRefinementSessionState(session, working);
  return command;
}

function buildCompletedRebuiltSupportPlan(
  session: RefinementSession,
  initialCoreParentIds: readonly CellId[],
  authorizedCompletionParentIds: ReadonlySet<CellId>,
  options: RefinementSessionPatchOptions
): RefinementSessionPatchPlan {
  const selectedCellIds = [...initialCoreParentIds].sort(compareCellIds);
  try {
    return buildRefinementSessionPatchPlan(session, selectedCellIds, options);
  } catch (error) {
    if (
      !(error instanceof DirectTwoToOnePlanningError)
      || error.kind !== "selection-signature"
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
    options
  );
  return buildRefinementSessionPatchPlan(session, completedCellIds, options);
}

function completeLogicalSupportParentBlock(
  session: RefinementSession,
  parentIds: readonly CellId[],
  level: number,
  authorizedCellIds: ReadonlySet<CellId>,
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
  const tolerance = options.mergeTolerance ?? minElementEdgeLength(active.mesh) * 0.000001;
  const lattice = inferHexElementLattice(active.mesh, tolerance);
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
          throw new Error(
            `logical support completion would cross the authorized support component at ${cellId}`
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
  supportCommand: RefinementSessionCommand,
  parentLevel: number
): Set<CellId> {
  const authorized = new Set(originalSupportParentIds);
  const supportCreatedCellIds = new Set(supportCommand.createdCellIds);
  const boundaryFaceKeys = new Set(originalSupportParentIds.flatMap((cellId) =>
    refinementCellFaceKeys(session, requiredCell(session, cellId))
  ));
  for (const cellId of session.activeLeafIds) {
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
    if (refinementCellFaceKeys(session, cell).some((faceKey) => boundaryFaceKeys.has(faceKey))) {
      authorized.add(cellId);
    }
  }
  return authorized;
}

function validateRebuiltSupportPlanOwnership(
  session: RefinementSession,
  replacementParentIds: readonly CellId[],
  originalSupportParentIds: readonly CellId[],
  supportCommand: RefinementSessionCommand
): void {
  const originalSupport = new Set(originalSupportParentIds);
  const supportCreated = new Set(supportCommand.createdCellIds);
  for (const cellId of replacementParentIds) {
    const cell = requiredCell(session, cellId);
    if (
      originalSupport.has(cellId)
      || cell.parentId === undefined
      || supportCreated.has(cellId)
    ) {
      continue;
    }
    throw new Error(
      `automatic transition-shell rebuilding would cross refinement-command provenance at ${cellId}`
    );
  }
}

function findCollidingTransitionParentIds(
  session: RefinementSession,
  selectedCellIds: readonly CellId[],
  supportLayerCellIds: readonly CellId[],
  level: number,
  options: RefinementSessionPatchOptions
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
    planningActive.mesh,
    selectedElementIds,
    {
      includeTransitions: options.includeTransitions ?? true,
      hexRefinementRatio: 2,
      transitionSupportElementIds: (options.transitionSupportCellIds ?? [])
        .map((cellId) => activeBuildElementIdByCellId(session, planningActive, cellId))
        .filter((elementId): elementId is number => elementId !== undefined),
      regularizeHexSelection: false,
      ...(options.mergeTolerance !== undefined ? { mergeTolerance: options.mergeTolerance } : {})
    }
  ).replacements;
  const replacementFaceKeys = new Set(replacements.flatMap((replacement) => {
    const cellId = activeBuildCellIdByElementId(planningActive, replacement.elementId);
    return cellId === undefined
      ? []
      : refinementCellFaceKeys(session, requiredCell(session, cellId));
  }));
  return [...new Set(supportLayerCellIds
    .filter((cellId) => {
      const cell = requiredCell(session, cellId);
      return isTransitionSessionCell(cell)
        && refinementCellFaceKeys(session, cell).some((faceKey) => replacementFaceKeys.has(faceKey));
    })
    .map((cellId) => requiredCell(session, cellId).parentId)
    .filter((parentId): parentId is CellId => parentId !== undefined))]
    .sort(compareCellIds);
}

function collectConnectedSupportLayerCells(
  session: RefinementSession,
  supportCellIds: readonly CellId[],
  selectedCellIds: readonly CellId[]
): CellId[] {
  const supportSet = new Set(supportCellIds);
  const selectedSupportCellIds = selectedCellIds.filter((cellId) => supportSet.has(cellId));
  if (selectedSupportCellIds.length !== selectedCellIds.length) {
    throw new Error("automatic transition-shell rebuilding selection is outside its supporting layer");
  }
  const cellIdsByFaceKey = new Map<string, CellId[]>();
  const faceKeysByCellId = new Map<CellId, string[]>();
  for (const cellId of supportCellIds) {
    const cell = requiredCell(session, cellId);
    const faceKeys = refinementCellFaceKeys(session, cell);
    faceKeysByCellId.set(cellId, faceKeys);
    for (const faceKey of faceKeys) {
      const owners = cellIdsByFaceKey.get(faceKey) ?? [];
      owners.push(cellId);
      cellIdsByFaceKey.set(faceKey, owners);
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
    for (const faceKey of faceKeysByCellId.get(cellId) ?? []) {
      for (const neighborId of cellIdsByFaceKey.get(faceKey) ?? []) {
        if (!component.has(neighborId)) {
          queue.push(neighborId);
        }
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

function refinementCellFaceKeys(
  session: RefinementSession,
  cell: RefinementSessionCell
): string[] {
  return H1_FACES.map((face) => face
    .map((localNodeId) => {
      const nodeId = cell.element[localNodeId - 1];
      const point = nodeId === undefined ? undefined : session.nodes[nodeId - 1];
      if (!point) {
        throw new Error(`cell ${cell.id} has an invalid Hex face`);
      }
      return exactActiveMergeKey(point);
    })
    .sort()
    .join("|"));
}

function auditNetHexCellReplacementQuality(
  parentSession: RefinementSession,
  parentCellIds: readonly CellId[],
  childSession: RefinementSession,
  childCellIds: readonly CellId[],
  relativeVolumeTolerance = 1e-8
): HexRefinementQualitySummary {
  if (parentCellIds.length === 0 || childCellIds.length === 0) {
    throw new Error("net Hex replacement quality audit requires parent and child cells");
  }
  const parent = summarizeHexSessionCells(parentSession, parentCellIds);
  const child = summarizeHexSessionCells(childSession, childCellIds);
  const parentOrientedVolume = parent.orientedVolume;
  const childOrientedVolume = child.orientedVolume;
  const relativeVolumeError = Math.abs(childOrientedVolume - parentOrientedVolume)
    / Math.max(parentOrientedVolume, Number.EPSILON);
  return {
    ok: parent.minimumOrientedScaledJacobian > 0
      && child.minimumOrientedScaledJacobian > 0
      && relativeVolumeError <= relativeVolumeTolerance,
    parentElementCount: parentCellIds.length,
    childElementCount: childCellIds.length,
    parentOrientedVolume,
    childOrientedVolume,
    relativeVolumeError,
    parentMinimumOrientedScaledJacobian: parent.minimumOrientedScaledJacobian,
    childMinimumOrientedScaledJacobian: child.minimumOrientedScaledJacobian
  };
}

function summarizeHexSessionCells(
  session: RefinementSession,
  cellIds: readonly CellId[]
): {
  orientedVolume: number;
  minimumOrientedScaledJacobian: number;
} {
  let orientedVolume = 0;
  let minimumOrientedScaledJacobian = Number.POSITIVE_INFINITY;
  for (const cellId of cellIds) {
    const cell = requiredCell(session, cellId);
    if (cell.kind !== "H1") {
      throw new Error(`net Hex replacement quality audit received non-Hex cell ${cellId}`);
    }
    const vertices = elementVertices(sessionMeshView(session), cell.element);
    const signedVolume = hexElementSignedVolume(vertices);
    const orientation = signedVolume < 0 ? -1 : 1;
    orientedVolume += orientation * signedVolume;
    minimumOrientedScaledJacobian = Math.min(
      minimumOrientedScaledJacobian,
      minimumOrientedHexCornerScaledJacobian(vertices, orientation)
    );
  }
  return {
    orientedVolume,
    minimumOrientedScaledJacobian
  };
}

function findSingleSupportCommand(
  session: RefinementSession,
  cellIds: readonly CellId[]
): RefinementSessionCommand {
  const commands = new Set<RefinementSessionCommand>();
  for (const cellId of cellIds) {
    const command = [...session.undoStack]
      .reverse()
      .find((candidate) => candidate.createdCellIds.includes(cellId));
    if (!command) {
      throw new Error(`automatic transition-shell rebuilding cannot trace cell ${cellId} to a refinement command`);
    }
    commands.add(command);
  }
  if (commands.size !== 1) {
    throw new Error("automatic transition-shell rebuilding requires cells from one supporting refinement command");
  }
  return [...commands][0]!;
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

function cloneRefinementSession(session: RefinementSession): RefinementSession {
  return {
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
  };
}

function cloneRefinementSessionCommand(command: RefinementSessionCommand): RefinementSessionCommand {
  return {
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
  };
}

function replaceRefinementSessionState(
  target: RefinementSession,
  source: RefinementSession
): void {
  target.baseMesh = source.baseMesh;
  target.kind = source.kind;
  target.nodes = source.nodes;
  target.cells = source.cells;
  target.activeLeafIds = source.activeLeafIds;
  target.sortedActiveLeafIds = source.sortedActiveLeafIds;
  target.sortedActiveLeafIdsDirty = source.sortedActiveLeafIdsDirty;
  target.activeLeafIdsByNodeKey = source.activeLeafIdsByNodeKey;
  target.undoStack = source.undoStack;
  target.redoStack = source.redoStack;
  target.nextCommandId = source.nextCommandId;
  target.nextCellOrdinal = source.nextCellOrdinal;
}

export function previewSessionPatch(
  session: RefinementSession,
  cellIds: CellId[],
  options: RefinementSessionPatchOptions = {}
): RefinementPreview<CellId> {
  const sourceActive = options.activeBuild ?? buildActiveMeshWithMap(session, {
    mergeNodes: true,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false,
    ...(options.mergeTolerance !== undefined ? { mergeTolerance: options.mergeTolerance } : {})
  });
  let patch: RefinementSessionPatchPlan;
  try {
    patch = buildRefinementSessionPatchPlan(session, cellIds, {
      ...options,
      activeBuild: sourceActive
    });
  } catch (error) {
    if (shouldRebuildExistingTransitionShell(session, cellIds, options, error)) {
      return previewSessionPatchWithRebuiltTransitionShell(
        session,
        cellIds,
        options,
        sourceActive
      );
    }
    throw error;
  }
  const replacedIds = new Set(patch.sourceReplacements.map((replacement) => replacement.elementId));
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
  const unchangedElementCount = sourceActive.mesh.elements.length - replacedIds.size;
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
}

function previewSessionPatchWithRebuiltTransitionShell(
  session: RefinementSession,
  cellIds: readonly CellId[],
  options: RefinementSessionPatchOptions,
  sourceActive: ActiveMeshBuildResult
): RefinementPreview<CellId> {
  const working = cloneRefinementSession(session);
  const command = refineSessionPatchWithRebuiltTransitionShell(working, [...cellIds], {
    ...options,
    activeBuild: sourceActive
  });
  const finalActive = buildActiveMeshWithMap(working, {
    mergeNodes: true,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false,
    ...(options.mergeTolerance !== undefined ? { mergeTolerance: options.mergeTolerance } : {})
  });
  const changedInputElementCount = command.hiddenCellIds.length;
  const inputElementCount = sourceActive.mesh.elements.length;
  return {
    kind: session.kind,
    planMode: "aggregate",
    plan: [],
    compound: {
      kind: "transition-shell-rebuild"
    },
    summary: {
      inputElementCount,
      changedInputElementCount,
      preservedInputElementCount: inputElementCount - changedInputElementCount,
      outputElementCount: finalActive.mesh.elements.length
    },
    twoToOne: command.twoToOne,
    ...(command.quality ? { quality: command.quality } : {})
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

  const classifiedPlan = buildDefaultRefinementPlan(active.mesh, selectedElementIds, {
    includeTransitions: options.includeTransitions ?? true,
    ...(options.hexRefinementRatio !== undefined
      ? { hexRefinementRatio: options.hexRefinementRatio }
      : {}),
    transitionSupportElementIds: (options.transitionSupportCellIds ?? [])
      .map((cellId) => activeBuildElementIdByCellId(session, active, cellId))
      .filter((elementId): elementId is number => elementId !== undefined),
    regularizeHexSelection: false,
    ...(options.mergeTolerance !== undefined ? { mergeTolerance: options.mergeTolerance } : {})
  });
  const replacements = classifiedPlan.replacements;
  const parentIds = new Set<CellId>();
  for (const replacement of replacements) {
    const parentId = activeBuildCellIdByElementId(active, replacement.elementId);
    if (parentId === undefined) {
      throw new Error(`replacement parent element ${replacement.elementId} is outside the active mesh`);
    }
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
    ? assertHexPatchQuality(sourceActive.mesh, sourceReplacements)
    : undefined;
  const twoToOne = classifiedPlan.twoToOne
    ? mapTwoToOneReportToCellIds(
        active,
        classifiedPlan.twoToOne,
        session.activeLeafIds.size
      )
    : undefined;

  return {
    sourceActive,
    planningActive: active,
    replacements,
    sourceReplacements,
    hiddenCellIds: [...parentIds].sort(compareCellIds),
    ...(quality ? { quality } : {}),
    ...(twoToOne
      ? { twoToOne }
      : {})
  };
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
  const tolerance = mergeTolerance ?? minElementEdgeLength(sourceActive.mesh) * 0.000001;
  const prospective = replaceElements(sourceActive.mesh, sourceReplacements, tolerance);
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
  });
}

function buildSameLevelRefinementPlanningMesh(
  session: RefinementSession,
  level: number,
  options: RefinementSessionPatchOptions
): ActiveMeshBuildResult {
  const activeIds = sortedActiveLeafIds(session).filter((cellId) => {
    const cell = session.cells.get(cellId);
    return cell?.level === level && isRefinableSessionCell(cell);
  });
  return buildActiveMeshForCellIdsWithMap(session, activeIds, {
    mergeNodes: true,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false,
    ...(options.mergeTolerance !== undefined ? { mergeTolerance: options.mergeTolerance } : {})
  });
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

  return sortedActiveLeafIds(session).filter((cellId) => haloCellIds.has(cellId));
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
  const command = session.undoStack.pop();
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
  session.redoStack.push(command);
  return command;
}

export function redoRefinementSession(session: RefinementSession): RefinementSessionCommand | undefined {
  const command = session.redoStack.pop();
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
  session.undoStack.push(command);
  return command;
}

function baseCellId(elementId: number): CellId {
  return `e${elementId}`;
}

function cloneMesh(mesh: Mesh): Mesh {
  const clone = {
    nodes: mesh.nodes.map((point) => [...point]),
    elements: mesh.elements.map((element) => [...element])
  };
  return mesh.kind ? { ...clone, kind: mesh.kind } : clone;
}

function requiredCell(session: RefinementSession, cellId: CellId): RefinementSessionCell {
  const cell = session.cells.get(cellId);
  if (!cell) {
    throw new Error(`cell ${cellId} does not exist`);
  }
  return cell;
}

function addActiveLeafCellId(session: RefinementSession, cellId: CellId): void {
  if (session.activeLeafIds.has(cellId)) {
    return;
  }
  const cell = requiredCell(session, cellId);
  session.activeLeafIds.add(cellId);
  session.sortedActiveLeafIdsDirty = true;
  for (const sessionNodeId of cell.element) {
    const point = session.nodes[sessionNodeId - 1];
    if (!point) {
      throw new Error(`active cell ${cellId} references missing node ${sessionNodeId}`);
    }
    const key = exactActiveMergeKey(point);
    const ownerIds = session.activeLeafIdsByNodeKey.get(key) ?? [];
    ownerIds.push(cellId);
    session.activeLeafIdsByNodeKey.set(key, ownerIds);
  }
}

function removeActiveLeafCellId(session: RefinementSession, cellId: CellId): void {
  const cell = requiredCell(session, cellId);
  if (!session.activeLeafIds.delete(cellId)) {
    return;
  }
  session.sortedActiveLeafIdsDirty = true;
  for (const sessionNodeId of cell.element) {
    const point = session.nodes[sessionNodeId - 1];
    if (!point) {
      throw new Error(`active cell ${cellId} references missing node ${sessionNodeId}`);
    }
    const key = exactActiveMergeKey(point);
    const ownerIds = session.activeLeafIdsByNodeKey.get(key);
    if (!ownerIds) {
      continue;
    }
    const nextOwnerIds = ownerIds.filter((ownerId) => ownerId !== cellId);
    if (nextOwnerIds.length === 0) {
      session.activeLeafIdsByNodeKey.delete(key);
    } else {
      session.activeLeafIdsByNodeKey.set(key, nextOwnerIds);
    }
  }
}

function sortedActiveLeafIds(session: RefinementSession): readonly CellId[] {
  if (session.sortedActiveLeafIdsDirty) {
    session.sortedActiveLeafIds = [...session.activeLeafIds].sort((a, b) => cellOrdinal(session, a) - cellOrdinal(session, b));
    session.sortedActiveLeafIdsDirty = false;
  }
  return session.sortedActiveLeafIds;
}

function nextCellOrdinal(session: RefinementSession): number {
  const ordinal = session.nextCellOrdinal ?? session.cells.size + 1;
  session.nextCellOrdinal = ordinal + 1;
  return ordinal;
}

function cellOrdinal(session: RefinementSession, cellId: CellId): number {
  return session.cells.get(cellId)?.ordinal ?? Number.MAX_SAFE_INTEGER;
}

function sessionMeshView(session: RefinementSession): Mesh {
  return {
    kind: session.kind,
    nodes: session.nodes,
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
  if (build.elementIdsByNodeId) {
    for (const nodeId of seedNodeIds) {
      for (const elementId of build.elementIdsByNodeId.get(nodeId) ?? []) {
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
  if (report.parentMinimumOrientedScaledJacobian <= 0) {
    throw new Error(
      `${label} starts from a parent with non-positive scaled Jacobian ` +
      `${report.parentMinimumOrientedScaledJacobian}`
    );
  }
  if (report.childMinimumOrientedScaledJacobian <= 0) {
    throw new Error(
      `${label} produced a non-positive scaled Jacobian ` +
      `${report.childMinimumOrientedScaledJacobian}`
    );
  }
  if (report.relativeVolumeError > 1e-8) {
    throw new Error(
      `${label} does not conserve parent volume; relative error is ` +
      `${report.relativeVolumeError}`
    );
  }
}

function assertHexPatchQuality(
  sourceMesh: Mesh,
  replacements: readonly ClassifiedReplacement[]
): HexRefinementQualitySummary {
  const quality = auditHexRefinementPatchQuality(sourceMesh, replacements);
  if (quality.parentMinimumOrientedScaledJacobian <= 0) {
    throw new HexPatchQualityError(
      "HEX_PATCH_PARENT_JACOBIAN",
      "refinement patch starts from a parent with non-positive scaled Jacobian " +
      `${quality.parentMinimumOrientedScaledJacobian}`
    );
  }
  if (quality.childMinimumOrientedScaledJacobian <= 0) {
    throw new HexPatchQualityError(
      "HEX_PATCH_CHILD_JACOBIAN",
      "refinement patch produced a non-positive scaled Jacobian " +
      `${quality.childMinimumOrientedScaledJacobian}`
    );
  }
  if (quality.relativeVolumeError > 1e-8) {
    throw new HexPatchQualityError(
      "HEX_PATCH_VOLUME",
      "refinement patch does not conserve parent volume; relative error is " +
      `${quality.relativeVolumeError}`
    );
  }
  return quality;
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
  return a.localeCompare(b);
}

function cellIdParts(cellId: CellId): number[] {
  const cached = cellIdPartsCache.get(cellId);
  if (cached) {
    return cached;
  }
  const parts = cellId.split("/").map((part) => Number(part.replace(/^e/, "")));
  cellIdPartsCache.set(cellId, parts);
  return parts;
}
