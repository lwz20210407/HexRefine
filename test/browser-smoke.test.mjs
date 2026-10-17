import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

test("GUI61 parallel auto-fit contains rotated box corners on desktop and mobile", async () => {
  const source = await readFile(new URL("examples/browser/refinement-gui.html", projectRoot), "utf8");
  const project = extractNamedFunction(source, "projectPoint");
  const fit = extractNamedFunction(source, "fitCameraToMesh");
  for (const [width,height] of [[1180,1000],[390,490]]) {
    const camera={center:[0,0,0],zoom:1,yaw:1.2,pitch:-.7,roll:.6};
    const run = new Function("mesh","camera","canvas","meshBounds",`
      const gui61Preview = {}, projectionMode = "parallel";
      const perspectiveDistanceForViewport = () => 1;
      ${project}\n${fit}\nfitCameraToMesh();return mesh.nodes.map(projectPoint);
    `);
    const nodes=[];for(const x of [-.5,1])for(const y of [-.5,1])for(const z of [-.5,1])nodes.push([x,y,z]);
    const projected=run({nodes},camera,{width,height},()=>({min:[-.5,-.5,-.5],max:[1,1,1]}));
    for(const p of projected){assert.ok(p.x>=width*.099&&p.x<=width*.901);assert.ok(p.y>=height*.139&&p.y<=height*.861);}
  }
});

test("ordinary browser import rejects beam decks before solid-only parsing", async () => {
  const gui = await readFile(new URL("examples/browser/refinement-gui.html", projectRoot), "utf8");
  const importer = extractNamedFunction(gui, "importMeshFile");
  const guard = importer.indexOf("ELEMENT_BEAM");
  assert.ok(guard >= 0 && guard < importer.indexOf("parseMeshText("));
  assert.match(importer, /throw new Error\("普通细化导入不支持含梁K/);
});

function extractNamedFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  assert.fail(`unterminated function ${name}`);
}

function standaloneRuntimeImportNames(source) {
  const importBlock = source.match(
    /import\s*\{([\s\S]*?)\}\s*from\s*"hexrefine\/index\.js";/
  );
  assert.ok(importBlock, "missing standalone runtime import block");
  return importBlock[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function standaloneSpecifier(fileName) {
  return `hexrefine/${fileName}`;
}

function rewriteStandaloneModuleSpecifiers(source) {
  return source
    .replaceAll(/from "\.\/([^"]+\.js)"/g, (_match, fileName) =>
      `from "${standaloneSpecifier(fileName)}"`
    )
    .replaceAll(/from '\.\/([^']+\.js)'/g, (_match, fileName) =>
      `from "${standaloneSpecifier(fileName)}"`
    )
    .replaceAll(/import\("\.\/([^"]+\.js)"\)/g, (_match, fileName) =>
      `import("${standaloneSpecifier(fileName)}")`
    )
    .replaceAll(/import\('\.\/([^']+\.js)'\)/g, (_match, fileName) =>
      `import("${standaloneSpecifier(fileName)}")`
    );
}

test("HexRefine browser GUI imports the project-local runtime build", async () => {
  const redirect = await readFile(new URL("examples/browser/hexrefine.html", projectRoot), "utf8");
  const gui = await readFile(new URL("examples/browser/refinement-gui.html", projectRoot), "utf8");
  const worker = await readFile(new URL("examples/browser/refinement-worker.js", projectRoot), "utf8");

  assert.match(redirect, /url=\.\/refinement-gui\.html/);
  assert.match(gui, /from\s+"..\/..\/dist\/index\.js"/);
  assert.match(worker, /from\s+"..\/..\/dist\/index\.js"/);
  assert.doesNotMatch(gui, /dist\/hexrefine\.js/);
  assert.doesNotMatch(worker, /dist\/hexrefine\.js/);
  assert.match(gui, /meshMergeTolerance\s*=\s*replay\.mergeTolerance\s*\?\?\s*meshMergeTolerance/);
  assert.match(gui, /function\s+buildActiveCellDataFromSession/);
  assert.match(gui, /activeBuildCellIdByElementId/);
  assert.match(gui, /validateActiveBuildForSession\(refinementSession,\s*response\.activeBuild\)/);
  assert.match(gui, /activeBuildSessionNodeIdsByNodeId/);
  assert.match(gui, /activeBuildHasSessionNodeIds/);
  assert.match(gui, /includeCellIdByElementId:\s*false/);
  assert.doesNotMatch(gui, /cellIdByElementId\?\?\.has|cellIdByElementId\.has/);
  assert.doesNotMatch(gui, /activeBuild\.sessionNodeIdsByNodeId\.(?:has|get)/);
  const standaloneBuilder = await readFile(new URL("scripts/build-standalone-lite.mjs", projectRoot), "utf8");
  assert.match(standaloneBuilder, /activeBuildCellIdByElementId/);
  assert.match(standaloneBuilder, /activeBuildElementIdByCellId/);
  assert.match(gui, /id="import-mesh"/);
  assert.match(gui, /id="webgl-preview"/);
  assert.match(gui, /id="projection-toggle"/);
  assert.match(gui, /id="hex-two-to-one-selection-mode"/);
  assert.match(gui, /hexTwoToOneSelectionMode/);
  assert.match(gui, /id="hex-transition-axis"/);
  assert.match(gui, /hexTransitionAxis/);
  assert.match(gui, /projectionMode\s*=\s*"perspective"/);
  assert.match(gui, /function\s+toggleProjectionMode/);
  assert.match(gui, /function\s+webglSurfaceProxyForCurrentMesh/);
  assert.match(gui, /function\s+surfaceFaceRecordsForCurrentVisibility/);
  assert.match(gui, /function\s+sortedFaceNodeIds/);
  assert.match(gui, /function\s+drawWebglWorldPositions/);
  assert.match(gui, /webgl world surface/);
  assert.match(gui, /parseMeshText/);
  assert.match(gui, /prepareSessionRefineSelection/);
  assert.match(gui, /previewSessionPatch\(refinementSession/);
  assert.match(gui, /minimum child scaled Jacobian/);
  assert.match(gui, /relative volume error/);
  assert.match(gui, /accept="application\/json,.json,.vtk,.vtu,.inp,.k,.key,text\/plain"/);
  assert.doesNotMatch(gui, /cellData:\s*\[\]/);
  assert.doesNotMatch(gui, /Regularized block rejected:/);

  const runtime = await import("../dist/index.js");
  assert.equal(typeof runtime.createHexUnitCubeMesh, "function");
  assert.equal(typeof runtime.meshFromSerializable, "function");
  assert.equal(typeof runtime.parseMeshText, "function");
  assert.equal(typeof runtime.parseLegacyVtkMesh, "function");
  assert.equal(typeof runtime.prepareSessionRefineSelection, "function");
  assert.equal(typeof runtime.validateActiveBuildForSession, "function");
  assert.equal(typeof runtime.previewSessionPatch, "function");
  assert.equal(typeof runtime.refineByElementIdsWithReport, "function");
});

test("HexRefine standalone binds and executes the session preview runtime entry", async () => {
  const standalone = await readFile(
    new URL("examples/browser/hexrefine-standalone.html", projectRoot),
    "utf8"
  );
  const standaloneBuilder = await readFile(
    new URL("scripts/build-standalone-lite.mjs", projectRoot),
    "utf8"
  );
  const importNames = standaloneRuntimeImportNames(standalone);
  const builderImportNames = standaloneRuntimeImportNames(standaloneBuilder);
  const runtime = await import("../dist/index.js");

  assert.match(standalone, /previewSessionPatch\(refinementSession/);
  for (const names of [builderImportNames, importNames]) {
    assert.ok(names.includes("previewSessionPatch"));
    assert.ok(names.includes("cloneTwoToOneCapabilityReport"));
    assert.ok(names.includes("validateActiveBuildForSession"));
    assert.ok(names.includes("activeBuildSessionNodeIdsByNodeId"));
    assert.ok(names.includes("activeBuildHasSessionNodeIds"));
    assert.equal(names.includes("previewRefinementByElementIds"), false);
  }
  assert.equal(typeof runtime.previewSessionPatch, "function");
  assert.equal(typeof runtime.cloneTwoToOneCapabilityReport, "function");

  const session = runtime.createRefinementSession(runtime.createHexUnitCubeMesh(2, 2, 2));
  const active = runtime.buildActiveMeshWithMap(session);
  const cellId = runtime.activeBuildCellIdByElementId(active, 1);
  assert.ok(cellId);
  const preview = runtime.previewSessionPatch(session, [cellId], {
    activeBuild: active
  });
  assert.equal(preview.planMode, "per-parent");
  assert.ok(preview.plan.length > 0);
});

test("HexRefine standalone embedded runtime modules match the current dist build", async () => {
  const standalone = await readFile(
    new URL("examples/browser/hexrefine-standalone.html", projectRoot),
    "utf8"
  );
  const importMapMatch = standalone.match(
    /<script type="importmap">([\s\S]*?)<\/script>/
  );
  assert.ok(importMapMatch, "missing standalone import map");
  const importMap = JSON.parse(importMapMatch[1]);
  const distUrl = new URL("dist/", projectRoot);
  const moduleNames = (await readdir(distUrl))
    .filter((name) => name.endsWith(".js"))
    .sort();

  for (const moduleName of moduleNames) {
    const source = await readFile(new URL(moduleName, distUrl), "utf8");
    const rewritten = rewriteStandaloneModuleSpecifiers(source);
    const expected = `data:text/javascript;base64,${Buffer.from(
      rewritten,
      "utf8"
    ).toString("base64")}`;
    assert.equal(
      importMap.imports[standaloneSpecifier(moduleName)],
      expected,
      `${moduleName} is stale or absent from the standalone runtime`
    );
  }
  for (const requiredModule of [
    "refinement-planner-internal.js",
    "transitions-internal.js",
    "refinement-errors.js",
    "hex-quality.js"
  ]) {
    assert.equal(
      typeof importMap.imports[standaloneSpecifier(requiredModule)],
      "string",
      `${requiredModule} is absent from the standalone runtime`
    );
  }
});

test("HexRefine worker build validation trusts legal clones and isolates cached mappings", async () => {
  const runtime = await import("../dist/index.js");
  const workerSession = runtime.createRefinementSession(
    runtime.createHexUnitCubeMesh(2, 1, 1)
  );
  const session = runtime.createRefinementSession(
    runtime.createHexUnitCubeMesh(2, 1, 1)
  );
  const workerBuild = runtime.buildActiveMeshWithMap(workerSession, {
    mergeNodes: true,
    mergeTolerance: 1e-9,
    includeSessionNodeIdsByNodeId: true
  });

  const tampered = structuredClone(workerBuild);
  tampered.elementIdByCellId.set("e1", 2);
  assert.throws(
    () => runtime.validateActiveBuildForSession(session, tampered),
    (error) => error instanceof runtime.TwoToOnePlanningError
      && error.code === "TWO_TO_ONE_UNRECOVERABLE_TOPOLOGY"
  );

  const transferred = structuredClone(workerBuild);
  assert.equal(
    runtime.validateActiveBuildForSession(session, transferred),
    transferred
  );
  assert.equal(runtime.activeBuildHasSessionNodeIds(transferred), true);
  const expectedSessionNodeIds =
    runtime.activeBuildSessionNodeIdsByNodeId(transferred, 1);
  assert.ok(expectedSessionNodeIds.length > 0);

  Map.prototype.set.call(transferred.elementIdByCellId, "e1", 2);
  Map.prototype.set.call(transferred.sessionNodeIdsByNodeId, 1, [999]);

  assert.equal(runtime.activeBuildElementIdByCellId(session, transferred, "e1"), 1);
  assert.deepEqual(
    runtime.activeBuildSessionNodeIdsByNodeId(transferred, 1),
    expectedSessionNodeIds
  );
});

test("HexRefine browser reports aggregate refinement previews without per-parent placeholders", async () => {
  const gui = await readFile(new URL("examples/browser/refinement-gui.html", projectRoot), "utf8");
  const standalone = await readFile(
    new URL("examples/browser/hexrefine-standalone.html", projectRoot),
    "utf8"
  );
  const functionSource = extractNamedFunction(gui, "refinementPreviewReportLines");
  assert.match(standalone, /function refinementPreviewReportLines\(preview\)/);
  const refinementPreviewReportLines = Function(
    `${functionSource}; return refinementPreviewReportLines;`
  )();
  const lines = refinementPreviewReportLines({
    planMode: "aggregate",
    summary: {
      inputElementCount: 1171,
      changedInputElementCount: 1037,
      preservedInputElementCount: 134,
      outputElementCount: 1669
    }
  });

  assert.deepEqual(lines, [
    "input elements: 1171",
    "changed input elements: 1037",
    "preserved input elements: 134",
    "output elements: 1669"
  ]);
  assert.doesNotMatch(lines.join("\n"), /undefined/);
  assert.doesNotMatch(lines.join("\n"), /selected parents|transitions|estimated elements/);

  assert.deepEqual(refinementPreviewReportLines({
    planMode: "per-parent",
    summary: {
      selectedElementCount: 1,
      faceTransitionElementCount: 3,
      edgeTransitionElementCount: 3,
      cornerTransitionElementCount: 0,
      unchangedElementCount: 1,
      estimatedOutputElementCount: 82
    }
  }), [
    "selected parents: 1",
    "face transitions: 3",
    "edge transitions: 3",
    "corner transitions: 0",
    "unchanged parents: 1",
    "estimated elements: 82"
  ]);
});

test("HexRefine browser command snapshots isolate optional arrays and capability reports", async () => {
  const gui = await readFile(new URL("examples/browser/refinement-gui.html", projectRoot), "utf8");
  const standalone = await readFile(
    new URL("examples/browser/hexrefine-standalone.html", projectRoot),
    "utf8"
  );
  const functionSource = extractNamedFunction(gui, "cloneRefinementSessionCommand");
  assert.equal(
    extractNamedFunction(standalone, "cloneRefinementSessionCommand"),
    functionSource
  );
  const runtime = await import("../dist/index.js");
  const cloneRefinementSessionCommand = Function(
    "cloneTwoToOneCapabilityReport",
    `${functionSource}; return cloneRefinementSessionCommand;`
  )(runtime.cloneTwoToOneCapabilityReport);
  const command = {
    id: "cmd-2",
    kind: "refine",
    hiddenCellIds: ["e1"],
    createdCellIds: ["e1/1"],
    activeCreatedCellIds: ["e1/1"],
    reactivatedCellIds: ["e2"],
    createdNodeIds: [9],
    twoToOne: {
      status: "compensated",
      topologyClass: "mixed-level",
      originalSelectedCellIds: ["e1"],
      effectiveSelectedCellIds: ["e1/1"],
      actions: [{
        kind: "transition-shell-rebuild",
        reason: "test",
        addedParentCellIds: ["e2"],
        replacedTransitionCellIds: ["e3"]
      }],
      affectedComponentCellIds: ["e1", "e1/1", "e2"],
      preservedFarFieldCellCount: 4
    }
  };
  const snapshot = cloneRefinementSessionCommand(command);

  command.hiddenCellIds.push("mutated-hidden");
  command.createdCellIds.push("mutated-created");
  command.activeCreatedCellIds.push("mutated-active");
  command.reactivatedCellIds.push("mutated-reactivated");
  command.createdNodeIds.push(10);
  command.twoToOne.originalSelectedCellIds.push("mutated-original");
  command.twoToOne.actions[0].addedParentCellIds.push("mutated-added");
  command.twoToOne.affectedComponentCellIds.push("mutated-affected");

  assert.deepEqual(snapshot, {
    id: "cmd-2",
    kind: "refine",
    hiddenCellIds: ["e1"],
    createdCellIds: ["e1/1"],
    activeCreatedCellIds: ["e1/1"],
    reactivatedCellIds: ["e2"],
    createdNodeIds: [9],
    twoToOne: {
      status: "compensated",
      topologyClass: "mixed-level",
      originalSelectedCellIds: ["e1"],
      effectiveSelectedCellIds: ["e1/1"],
      actions: [{
        kind: "transition-shell-rebuild",
        reason: "test",
        addedParentCellIds: ["e2"],
        replacedTransitionCellIds: ["e3"]
      }],
      affectedComponentCellIds: ["e1", "e1/1", "e2"],
      preservedFarFieldCellCount: 4
    }
  });
});

test("HexRefine GUI delete restore preserves revision and permits preview then refine", async () => {
  const gui = await readFile(new URL("examples/browser/refinement-gui.html", projectRoot), "utf8");
  const standalone = await readFile(
    new URL("examples/browser/hexrefine-standalone.html", projectRoot),
    "utf8"
  );
  const cloneSource = extractNamedFunction(gui, "cloneRefinementSessionState");
  const restoreSource = extractNamedFunction(gui, "restoreRefinementSessionState");
  assert.equal(
    extractNamedFunction(standalone, "cloneRefinementSessionState"),
    cloneSource
  );
  assert.equal(
    extractNamedFunction(standalone, "restoreRefinementSessionState"),
    restoreSource
  );
  const cloneRefinementSessionState = Function(
    "cloneMeshForCommand",
    "cloneRefinementSessionCommand",
    `${cloneSource}; return cloneRefinementSessionState;`
  )(
    (mesh) => ({
      ...(mesh.kind ? { kind: mesh.kind } : {}),
      nodes: mesh.nodes.map((point) => [...point]),
      elements: mesh.elements.map((element) => [...element])
    }),
    (command) => structuredClone(command)
  );
  const restoreRefinementSessionState = Function(
    "cloneRefinementSessionState",
    `${restoreSource}; return restoreRefinementSessionState;`
  )(cloneRefinementSessionState);
  const runtime = await import("../dist/index.js");
  const session = runtime.createRefinementSession(runtime.createHexUnitCubeMesh(2, 1, 1));
  const snapshot = cloneRefinementSessionState(session);
  const deleted = runtime.createRefinementSession(runtime.createHexUnitCubeMesh(1, 1, 1));
  deleted.revision = 4;

  assert.equal(snapshot.revision, 0);
  const restored = restoreRefinementSessionState(deleted, snapshot, true);
  assert.equal(restored.revision, 5);
  const active = runtime.buildActiveMeshWithMap(restored, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const preview = runtime.previewSessionPatch(restored, ["e1"], {
    includeTransitions: false,
    activeBuild: active
  });
  assert.ok(preview.plan.length > 0);
  const command = runtime.refineSessionPatch(restored, ["e1"], {
    includeTransitions: false,
    activeBuild: active
  });
  assert.ok(command.createdCellIds.length > 0);
  assert.equal(restored.revision, 6);
});
