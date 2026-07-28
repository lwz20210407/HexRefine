import type {
  ActiveMeshBuildResult,
  Mesh
} from "../../src/index.js";

declare const mutableMesh: Mesh;
mutableMesh.nodes.push([0, 0, 0]);
mutableMesh.elements.push([1, 2, 3, 4]);

declare const activeBuild: ActiveMeshBuildResult;
activeBuild.elementIdByCellOrdinalArray?.subarray(0, 1);

// @ts-expect-error Active build mappings are public read-only views.
activeBuild.cellIdByElementId.set(1, "e1");
// @ts-expect-error Active build mappings are public read-only views.
activeBuild.elementIdByCellId.clear();
