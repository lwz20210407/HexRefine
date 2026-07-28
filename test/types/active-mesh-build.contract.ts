import type {
  ActiveMeshBuildResult,
  Mesh,
  RefinementSession,
  RefinementSessionCell,
  RefinementSessionCommand
} from "../../src/index.js";
import {
  checkNoHangingNodes,
  createRefinementSession,
  validateActiveBuildCellsForSession
} from "../../src/index.js";

declare const mutableMesh: Mesh;
mutableMesh.nodes.push([0, 0, 0]);
mutableMesh.elements.push([1, 2, 3, 4]);

declare const activeBuild: ActiveMeshBuildResult;
activeBuild.elementIdByCellOrdinalArray?.subarray(0, 1);
checkNoHangingNodes(activeBuild.mesh);
createRefinementSession(activeBuild.mesh);

// @ts-expect-error Frozen active build output cannot masquerade as mutable Mesh.
const mutableActiveMesh: Mesh = activeBuild.mesh;
void mutableActiveMesh;

// @ts-expect-error Active build mappings are public read-only views.
activeBuild.cellIdByElementId.set(1, "e1");
// @ts-expect-error Active build mappings are public read-only views.
activeBuild.elementIdByCellId.clear();

declare const session: RefinementSession;
declare const sessionCell: RefinementSessionCell;
validateActiveBuildCellsForSession(session, activeBuild, ["e1"]);

// Refinement sessions are mutated only by the official session command APIs.
// @ts-expect-error Session node storage is a public read-only view.
session.nodes.push([0, 0, 0]);
// @ts-expect-error Session node coordinates are public read-only values.
session.nodes[0]![0] = 1;
// @ts-expect-error Session cells are a public read-only view.
session.cells.set("e1", sessionCell);
// @ts-expect-error Active leaves are a public read-only view.
session.activeLeafIds.add("e1");
// @ts-expect-error Cell metadata is public read-only state.
sessionCell.level = 1;
// @ts-expect-error Cell connectivity is a public read-only view.
sessionCell.element.push(1);
// @ts-expect-error Cell descendants are a public read-only view.
sessionCell.children.push("child");

declare const command: RefinementSessionCommand;
// @ts-expect-error Command arrays are immutable public history.
command.createdCellIds.push("tampered");
// @ts-expect-error Optional command arrays are immutable public history.
command.activeCreatedCellIds?.splice(0);
// @ts-expect-error Command quality reports are immutable.
command.quality!.ok = false;
// @ts-expect-error Command capability actions are immutable.
command.twoToOne!.actions.push({
  kind: "local-template",
  reason: "tampered",
  addedParentCellIds: [],
  replacedTransitionCellIds: []
});
// @ts-expect-error Nested command action arrays are immutable.
command.twoToOne!.actions[0]!.addedParentCellIds.push("tampered");
