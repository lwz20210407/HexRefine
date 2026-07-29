import {
  refinementPlanner,
  transitions
} from "../../src/index.js";
import * as root from "../../src/index.js";
import {
  planRefinementSessionHistoryTransaction
} from "../../src/refinement-session.js";
import type {
  ActiveMeshBuildProvenance,
  ActiveMeshBuildResult,
  ActiveMeshGeometryResolution,
  ActiveMeshSetRemapResult,
  BuildActiveMeshOptions,
  CellId,
  LocalRefinementFactory,
  RefinementSession,
  RefinementSessionCell,
  RefinementSessionCellRole,
  RefinementSessionCommand,
  RefinementSessionExportOptions,
  RefinementSessionExportResult,
  RefinementSessionHistoryTransactionPlan,
  RefinementSessionLocalConformanceReport,
  RefinementSessionNamedSets,
  RefinementSessionPatchOptions,
  RefinementSessionSelectionValidation,
  RefinementSessionSetRemapInput,
  SessionFaceResolution
} from "../../src/refinement-session.js";
import type {
  ActiveMeshBuildProvenance as RootActiveMeshBuildProvenance,
  ActiveMeshBuildResult as RootActiveMeshBuildResult,
  ActiveMeshGeometryResolution as RootActiveMeshGeometryResolution,
  ActiveMeshSetRemapResult as RootActiveMeshSetRemapResult,
  BuildActiveMeshOptions as RootBuildActiveMeshOptions,
  CellId as RootCellId,
  LocalRefinementFactory as RootLocalRefinementFactory,
  RefinementSession as RootRefinementSession,
  RefinementSessionCell as RootRefinementSessionCell,
  RefinementSessionCellRole as RootRefinementSessionCellRole,
  RefinementSessionCommand as RootRefinementSessionCommand,
  RefinementSessionExportOptions as RootRefinementSessionExportOptions,
  RefinementSessionExportResult as RootRefinementSessionExportResult,
  RefinementSessionLocalConformanceReport as RootRefinementSessionLocalConformanceReport,
  RefinementSessionNamedSets as RootRefinementSessionNamedSets,
  RefinementSessionPatchOptions as RootRefinementSessionPatchOptions,
  RefinementSessionSelectionValidation as RootRefinementSessionSelectionValidation,
  RefinementSessionSetRemapInput as RootRefinementSessionSetRemapInput
} from "../../src/index.js";

// @ts-expect-error unchecked planners are internal and absent from public declarations
refinementPlanner.buildDefaultRefinementPlanUnchecked;
// @ts-expect-error unchecked Hex planners are internal and absent from public declarations
transitions.buildHexClassifiedPlanUnchecked;

type DirectInternalTypes = [
  SessionFaceResolution,
  RefinementSessionHistoryTransactionPlan
];
type RootSessionTypes = [
  RootCellId,
  RootRefinementSessionCellRole,
  RootRefinementSessionCell,
  RootRefinementSessionCommand,
  RootRefinementSession,
  RootBuildActiveMeshOptions,
  RootActiveMeshBuildResult,
  RootActiveMeshGeometryResolution,
  RootActiveMeshBuildProvenance,
  RootRefinementSessionNamedSets<string>,
  RootRefinementSessionSetRemapInput,
  RootActiveMeshSetRemapResult,
  RootRefinementSessionExportOptions,
  RootRefinementSessionExportResult,
  RootRefinementSessionLocalConformanceReport,
  RootRefinementSessionSelectionValidation,
  RootLocalRefinementFactory,
  RootRefinementSessionPatchOptions
];
type NamespaceSessionTypes = [
  root.refinementSession.CellId,
  root.refinementSession.RefinementSessionCellRole,
  root.refinementSession.RefinementSessionCell,
  root.refinementSession.RefinementSessionCommand,
  root.refinementSession.RefinementSession,
  root.refinementSession.BuildActiveMeshOptions,
  root.refinementSession.ActiveMeshBuildResult,
  root.refinementSession.ActiveMeshGeometryResolution,
  root.refinementSession.ActiveMeshBuildProvenance,
  root.refinementSession.RefinementSessionNamedSets<string>,
  root.refinementSession.RefinementSessionSetRemapInput,
  root.refinementSession.ActiveMeshSetRemapResult,
  root.refinementSession.RefinementSessionExportOptions,
  root.refinementSession.RefinementSessionExportResult,
  root.refinementSession.RefinementSessionLocalConformanceReport,
  root.refinementSession.RefinementSessionSelectionValidation,
  root.refinementSession.LocalRefinementFactory,
  root.refinementSession.RefinementSessionPatchOptions
];
type DirectLegacySessionTypes = [
  CellId,
  RefinementSessionCellRole,
  RefinementSessionCell,
  RefinementSessionCommand,
  RefinementSession,
  BuildActiveMeshOptions,
  ActiveMeshBuildResult,
  ActiveMeshGeometryResolution,
  ActiveMeshBuildProvenance,
  RefinementSessionNamedSets<string>,
  RefinementSessionSetRemapInput,
  ActiveMeshSetRemapResult,
  RefinementSessionExportOptions,
  RefinementSessionExportResult,
  RefinementSessionLocalConformanceReport,
  RefinementSessionSelectionValidation,
  LocalRefinementFactory,
  RefinementSessionPatchOptions
];

declare const directInternalTypes: DirectInternalTypes;
declare const rootSessionTypes: RootSessionTypes;
declare const namespaceSessionTypes: NamespaceSessionTypes;
declare const directLegacySessionTypes: DirectLegacySessionTypes;
void directInternalTypes;
void rootSessionTypes;
void namespaceSessionTypes;
void directLegacySessionTypes;
void planRefinementSessionHistoryTransaction;

// @ts-expect-error history transaction planner is direct-module internal
root.planRefinementSessionHistoryTransaction;
// @ts-expect-error history transaction planner is absent from the public namespace
root.refinementSession.planRefinementSessionHistoryTransaction;
// @ts-expect-error history transaction face resolution is direct-module internal
type RootSessionFaceResolution = root.SessionFaceResolution;
// @ts-expect-error history transaction plan is absent from the public namespace
type NamespaceHistoryTransactionPlan = root.refinementSession.RefinementSessionHistoryTransactionPlan;
// @ts-expect-error transition history component discovery is session-internal
type RootTransitionHistoryComponent = root.TransitionHistoryComponent;
// @ts-expect-error transition history component discovery is absent from the public history namespace
type NamespaceTransitionHistoryComponent = root.refinementHistory.TransitionHistoryComponent;
