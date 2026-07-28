import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  checkNoHangingNodes,
  createHexUnitCubeMesh,
  createRefinementSession,
  buildNativeSessionExportPlan,
  buildRefinementSessionExport,
  iterateLegacyVtkLines,
  iterateNativeSessionInpLines,
  iterateNativeSessionVtkLines,
  iteratePreparedInpLines,
  meshFromSerializable,
  meshToLsdynaKeyword,
  meshToLegacyVtk,
  meshSelection,
  parseLegacyVtkMesh,
  parseMeshText,
  prepareExportMesh,
  refinementSessionExportToInp,
  refinementOps,
  replayHexRefineCommandScript
} from "../dist/index.js";

function loadLsdynaRegressionFixture(name) {
  const root = new URL("./fixtures/lsdyna/", import.meta.url);
  const keyword = readFileSync(new URL(`${name}.k`, root), "utf8");
  const manifest = JSON.parse(
    readFileSync(new URL(`${name}.json`, root), "utf8")
  );
  return {
    keyword,
    manifest,
    mesh: parseMeshText(keyword, `${name}.k`)
  };
}

function assertMeshOnlyKeyword(keyword) {
  const keywords = keyword
    .split(/\r?\n/)
    .map((line) => line.trim().toUpperCase())
    .filter((line) => line.startsWith("*"));
  assert.deepEqual(keywords, [
    "*KEYWORD",
    "*NODE",
    "*ELEMENT_SOLID",
    "*END"
  ]);
}

function assertPoint(actual, expected, tolerance) {
  assert.equal(actual.length, expected.length);
  for (let axis = 0; axis < expected.length; axis += 1) {
    assert.ok(
      Math.abs(actual[axis] - expected[axis]) <= tolerance,
      `coordinate ${axis}: ${actual[axis]} != ${expected[axis]}`
    );
  }
}

function inpSetIds(text, keyword, name) {
  const lines = text.split(/\r?\n/);
  const header = `*${keyword}, ${keyword.toLowerCase()}=${name}`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) {
    return [];
  }
  const ids = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.startsWith("*")) {
      break;
    }
    if (line.length === 0) {
      continue;
    }
    ids.push(...line.split(",").map((value) => Number(value.trim())).filter(Number.isFinite));
  }
  return ids;
}

test("HexRefine project entry exposes mesh selection and non-field refinement", () => {
  const mesh = createHexUnitCubeMesh(3, 3, 3);
  const selected = meshSelection.selectElementsByDistanceFunction(mesh, (x, y, z) =>
    Math.min(0.75 - x, x - 0.25, 0.75 - y, y - 0.25, 0.75 - z, z - 0.25),
  0);

  assert.ok(selected.inside.length > 0);

  const result = refinementOps.refineByElementIdsWithReport(mesh, selected.inside, {
    regularizeHexSelection: true
  });
  assert.ok(result.mesh.elements.length > mesh.elements.length);

  const report = checkNoHangingNodes(result.mesh, 1e-8);
  assert.equal(report.ok, true);
});

test("HexRefine project command replay rebuilds a refined mesh with sets", () => {
  const replay = replayHexRefineCommandScript({
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 2,
          ny: 2,
          nz: 2,
          bounds: { min: [0, 0, 0], max: [1, 1, 1] }
        }
      },
      {
        kind: "refine.patch",
        payload: {
          elementIds: [1],
          options: { includeTransitions: true }
        }
      },
      {
        kind: "set.cells.save",
        payload: {
          name: "CORE",
          elementIds: [1],
          material: { name: "steel", elasticModulus: 210000, poissonRatio: 0.3 }
        }
      }
    ]
  });

  assert.equal(replay.replayedCommandCount, 3);
  assert.ok(replay.mesh.elements.length > 8);
  assert.ok(replay.cellSets.has("CORE"));
  assert.equal(replay.cellSetMaterials.get("CORE")?.name, "steel");
  assert.equal(checkNoHangingNodes(replay.mesh, 1e-8).ok, true);
});

test("HexRefine command replay accepts the 2:1 Hex refinement ratio", () => {
  const replay = replayHexRefineCommandScript({
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 2,
          ny: 2,
          nz: 5,
          bounds: { min: [0, 0, 0], max: [1, 1, 1] }
        }
      },
      {
        kind: "refine.patch",
        payload: {
          elementIds: [9, 10, 11, 12],
          options: {
            includeTransitions: true,
            hexRefinementRatio: 2,
            hexTransitionAxis: 2
          }
        }
      }
    ]
  });

  assert.equal(replay.mesh.elements.length, 96);
  assert.equal(checkNoHangingNodes(replay.mesh, 1e-9).ok, true);
});

test("HexRefine command replay accepts the local-box 2:1 selection mode", () => {
  const replay = replayHexRefineCommandScript({
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 5,
          ny: 5,
          nz: 5,
          bounds: { min: [0, 0, 0], max: [1, 1, 1] }
        }
      },
      {
        kind: "refine.patch",
        payload: {
          elementIds: [63],
          options: {
            includeTransitions: true,
            hexRefinementRatio: 2,
            hexTwoToOneSelectionMode: "local"
          }
        }
      }
    ]
  });

  assert.equal(replay.mesh.elements.length, 283);
  assert.equal(checkNoHangingNodes(replay.mesh, 1e-9).ok, true);
});

test("HexRefine command replay rejects an invalid 2:1 transition axis", () => {
  assert.throws(
    () =>
      replayHexRefineCommandScript({
        commands: [
          {
            kind: "grid.generate",
            payload: {
              kind: "H1",
              nx: 2,
              ny: 2,
              nz: 5,
              bounds: { min: [0, 0, 0], max: [1, 1, 1] }
            }
          },
          {
            kind: "refine.patch",
            payload: {
              elementIds: [9, 10, 11, 12],
              options: {
                includeTransitions: true,
                hexRefinementRatio: 2,
                hexTransitionAxis: 3
              }
            }
          }
        ]
      }),
    /hexTransitionAxis must be 0, 1, or 2/
  );
});

test("HexRefine command replay rejects an invalid 2:1 selection mode", () => {
  assert.throws(
    () =>
      replayHexRefineCommandScript({
        commands: [
          {
            kind: "grid.generate",
            payload: {
              kind: "H1",
              nx: 5,
              ny: 5,
              nz: 5,
              bounds: { min: [0, 0, 0], max: [1, 1, 1] }
            }
          },
          {
            kind: "refine.patch",
            payload: {
              elementIds: [63],
              options: {
                includeTransitions: true,
                hexRefinementRatio: 2,
                hexTwoToOneSelectionMode: "spiral"
              }
            }
          }
        ]
      }),
    /hexTwoToOneSelectionMode must be section or local/
  );
});

test("HexRefine project imports standard Quad and Hex meshes from JSON-like objects", () => {
  const quad = meshFromSerializable({
    nodes: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1]
    ],
    elements: [[1, 2, 3, 4]]
  });
  const quadResult = refinementOps.refineByElementIdsWithReport(quad, [1], {
    includeTransitions: true
  });

  const hex = meshFromSerializable({
    nodes: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1]
    ],
    elements: [[1, 2, 3, 4, 5, 6, 7, 8]]
  });
  const hexResult = refinementOps.refineByElementIdsWithReport(hex, [1], {
    includeTransitions: true
  });

  assert.equal(quad.kind, "Q1");
  assert.equal(hex.kind, "H1");
  assert.ok(quadResult.mesh.elements.length > quad.elements.length);
  assert.ok(hexResult.mesh.elements.length > hex.elements.length);
});

test("HexRefine project command replay supports imported starting meshes", () => {
  const replay = replayHexRefineCommandScript({
    commands: [
      {
        kind: "grid.import",
        payload: {
          mesh: {
            nodes: [
              [0, 0, 0],
              [1, 0, 0],
              [1, 1, 0],
              [0, 1, 0],
              [0, 0, 1],
              [1, 0, 1],
              [1, 1, 1],
              [0, 1, 1]
            ],
            elements: [[1, 2, 3, 4, 5, 6, 7, 8]]
          }
        }
      },
      {
        kind: "refine.patch",
        payload: {
          elementIds: [1],
          options: { includeTransitions: true }
        }
      }
    ]
  });

  assert.equal(replay.mesh.kind, "H1");
  assert.ok(replay.mesh.elements.length > 1);
});

test("HexRefine project imports legacy VTK quad and hex meshes", () => {
  const quadVtk = meshToLegacyVtk({
    kind: "Q1",
    nodes: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1]
    ],
    elements: [[1, 2, 3, 4]]
  }, { title: "quad" });
  const hexVtk = meshToLegacyVtk({
    kind: "H1",
    nodes: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1]
    ],
    elements: [[1, 2, 3, 4, 5, 6, 7, 8]]
  }, { title: "hex" });

  const quad = parseLegacyVtkMesh(quadVtk);
  const hex = parseMeshText(hexVtk, "box.vtk");

  assert.equal(quad.kind, "Q1");
  assert.equal(quad.elements.length, 1);
  assert.equal(hex.kind, "H1");
  assert.equal(hex.elements.length, 1);
});

test("HexRefine project auto-detects Abaqus INP, LS-DYNA K, and VTU meshes from file suffixes", () => {
  const abaqusInp = [
    "*Heading",
    "HexRefine Abaqus import",
    "*Node",
    "10, 0, 0, 0",
    "20, 1, 0, 0",
    "30, 1, 1, 0",
    "40, 0, 1, 0",
    "50, 0, 0, 1",
    "60, 1, 0, 1",
    "70, 1, 1, 1",
    "80, 0, 1, 1",
    "*Element, type=C3D8",
    "100, 10, 20, 30, 40, 50, 60, 70, 80"
  ].join("\n");
  const lsdynaKeyword = [
    "*KEYWORD",
    "*NODE",
    "101, 0, 0, 0",
    "102, 1, 0, 0",
    "103, 1, 1, 0",
    "104, 0, 1, 0",
    "*ELEMENT_SHELL",
    "1, 1, 101, 102, 103, 104",
    "*END"
  ].join("\n");
  const vtu = [
    "<?xml version=\"1.0\"?>",
    "<VTKFile type=\"UnstructuredGrid\" version=\"0.1\" byte_order=\"LittleEndian\">",
    "  <UnstructuredGrid>",
    "    <Piece NumberOfPoints=\"4\" NumberOfCells=\"1\">",
    "      <Points>",
    "        <DataArray type=\"Float64\" NumberOfComponents=\"3\" format=\"ascii\">",
    "          0 0 0  1 0 0  1 1 0  0 1 0",
    "        </DataArray>",
    "      </Points>",
    "      <Cells>",
    "        <DataArray type=\"Int32\" Name=\"connectivity\" format=\"ascii\">0 1 2 3</DataArray>",
    "        <DataArray type=\"Int32\" Name=\"offsets\" format=\"ascii\">4</DataArray>",
    "        <DataArray type=\"UInt8\" Name=\"types\" format=\"ascii\">9</DataArray>",
    "      </Cells>",
    "    </Piece>",
    "  </UnstructuredGrid>",
    "</VTKFile>"
  ].join("\n");

  const abaqus = parseMeshText(abaqusInp, "block.inp");
  const lsdyna = parseMeshText(lsdynaKeyword, "shell.k");
  const quadVtu = parseMeshText(vtu, "quad.vtu");

  assert.equal(abaqus.kind, "H1");
  assert.deepEqual(abaqus.elements, [[1, 2, 3, 4, 5, 6, 7, 8]]);
  assert.equal(lsdyna.kind, "Q1");
  assert.deepEqual(lsdyna.elements, [[1, 2, 3, 4]]);
  assert.equal(quadVtu.kind, "Q1");
  assert.deepEqual(quadVtu.elements, [[1, 2, 3, 4]]);
});

test("HexRefine imports LS-DYNA fixed-field nodes with blank zero coordinates", () => {
  const fixedInteger = (value) => String(value).padStart(8, " ");
  const fixedCoordinate = (value) =>
    value === 0 ? " ".repeat(16) : String(value).padStart(16, " ");
  const node = (id, x, y, z) =>
    `${fixedInteger(id)}${fixedCoordinate(x)}${fixedCoordinate(y)}${fixedCoordinate(z)}${" ".repeat(16)}`;
  const solid = (id, partId, nodeIds) =>
    [id, partId, ...nodeIds].map(fixedInteger).join("");
  const keyword = [
    "*KEYWORD",
    "*NODE",
    "$#   nid               x               y               z      tc      rc",
    node(49166, 0, 35, 5),
    node(49167, 1, 35, 5),
    node(49168, 1, 36, 5),
    node(49169, 0, 36, 5),
    node(49170, 0, 35, 6),
    node(49171, 1, 35, 6),
    node(49172, 1, 36, 6),
    node(49173, 0, 36, 6),
    "*ELEMENT_SOLID",
    solid(44440, 1, [49166, 49167, 49168, 49169, 49170, 49171, 49172, 49173]),
    "*END"
  ].join("\n");

  const mesh = parseMeshText(keyword, "fixed-field.k");

  assert.equal(mesh.kind, "H1");
  assert.deepEqual(mesh.nodes[0], [0, 35, 5]);
  assert.deepEqual(mesh.elements, [[1, 2, 3, 4, 5, 6, 7, 8]]);
});

test("HexRefine refines an anonymized real-deck O-grid gauge slab at 2:1", () => {
  const fixtureUrl = new URL("./fixtures/lsdyna/real-ogrid-gauge-slab.k", import.meta.url);
  const mesh = parseMeshText(readFileSync(fixtureUrl, "utf8"), "real-ogrid-gauge-slab.k");
  const selected = mesh.elements
    .map((element, index) => ({
      elementId: index + 1,
      y: element.reduce((total, nodeId) => total + mesh.nodes[nodeId - 1][1], 0) / 8
    }))
    .filter(({ y }) => Math.abs(y) < 0.06)
    .map(({ elementId }) => elementId);

  assert.equal(mesh.kind, "H1");
  assert.equal(mesh.nodes.length, 1687);
  assert.equal(mesh.elements.length, 1320);
  assert.equal(selected.length, 440);

  const result = refinementOps.refineByElementIdsWithReport(mesh, selected, {
    hexRefinementRatio: 2,
    regularizeHexSelection: false
  });

  assert.equal(result.summary.selectedElementCount, 440);
  assert.equal(result.summary.faceTransitionElementCount, 440);
  assert.equal(result.summary.unchangedElementCount, 440);
  assert.equal(result.mesh.elements.length, 7040);
  assert.equal(result.quality?.ok, true);
  assert.ok((result.quality?.relativeVolumeError ?? Infinity) < 1e-12);
  assert.ok((result.quality?.childMinimumOrientedScaledJacobian ?? 0) > 0.25);
  assert.equal(checkNoHangingNodes(result.mesh, 1e-8).ok, true);
});

for (const name of [
  "tension-gauge-slab",
  "compression-ogrid-ring",
  "double-shear-contact-shell"
]) {
  test(`HexRefine refines and round-trips ${name}`, () => {
    const { keyword, manifest, mesh } =
      loadLsdynaRegressionFixture(name);
    assertMeshOnlyKeyword(keyword);
    assert.equal(mesh.nodes.length, manifest.expectedInputNodeCount);
    assert.equal(mesh.elements.length, manifest.expectedInputElementCount);

    const result = refinementOps.refineByElementIdsWithReport(
      mesh,
      manifest.selectedElementIds,
      manifest.options
    );
    assert.equal(result.twoToOne.status, manifest.expectedStatus);
    assert.equal(result.mesh.nodes.length, manifest.expectedOutputNodeCount);
    assert.equal(
      result.mesh.elements.length,
      manifest.expectedOutputElementCount
    );
    assert.equal(checkNoHangingNodes(result.mesh, 1e-8).ok, true);
    assert.ok(
      result.quality.childMinimumOrientedScaledJacobian
      >= manifest.minimumScaledJacobian
    );
    assert.equal(
      manifest.selectedElementIds.every((parentElementId) =>
        result.cellData.filter((cell) =>
          cell.parentElementId === parentElementId
          && cell.role === "selected"
        ).length === 8
      ),
      true
    );

    const output = meshToLsdynaKeyword(result.mesh, { partId: 1 });
    assertMeshOnlyKeyword(output);
    const reparsed = parseMeshText(output, `${name}-refined.k`);
    assert.deepEqual(reparsed.elements, result.mesh.elements);
    assert.equal(reparsed.nodes.length, result.mesh.nodes.length);
    for (let index = 0; index < reparsed.nodes.length; index += 1) {
      assertPoint(reparsed.nodes[index], result.mesh.nodes[index], 1e-8);
    }
  });
}

test("HexRefine project rejects non-quad and non-hex VTK and Abaqus INP imports", () => {
  const tetraInp = [
    "*Heading",
    "unsupported tetra",
    "*Node",
    "1, 0, 0, 0",
    "2, 1, 0, 0",
    "3, 0, 1, 0",
    "4, 0, 0, 1",
    "*Element, type=C3D4",
    "1, 1, 2, 3, 4"
  ].join("\n");
  const triangleVtk = [
    "# vtk DataFile Version 3.0",
    "triangle",
    "ASCII",
    "DATASET UNSTRUCTURED_GRID",
    "POINTS 3 double",
    "0 0 0",
    "1 0 0",
    "0 1 0",
    "CELLS 1 4",
    "3 0 1 2",
    "CELL_TYPES 1",
    "5"
  ].join("\n");

  assert.throws(
    () => parseMeshText(tetraInp, "tetra.inp"),
    /Abaqus import only supports 4-node quad\/shell and 8-node hex\/solid elements, got element type C3D4/
  );
  assert.throws(
    () => parseMeshText(triangleVtk, "triangle.vtk"),
    /VTK import only supports CELL_TYPES 9 \(QUAD\) and 12 \(HEXAHEDRON\), got 5/
  );
});

test("HexRefine project streams legacy VTK lines without changing file content", () => {
  const mesh = {
    kind: "H1",
    nodes: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1]
    ],
    elements: [[1, 2, 3, 4, 5, 6, 7, 8]]
  };
  const options = {
    title: "streamed",
    cellScalars: {
      selected: [1]
    }
  };

  const text = meshToLegacyVtk(mesh, options);
  const streamed = `${[...iterateLegacyVtkLines(mesh, options)].join("\n")}\n`;

  assert.equal(streamed, text);
});

test("HexRefine project streams INP lines without changing file content", () => {
  const exported = buildRefinementSessionExport(createRefinementSession(createHexUnitCubeMesh(1, 1, 1)), {
    mergeNodes: true
  });
  const options = { title: "HexRefine streaming INP smoke" };
  const prepared = prepareExportMesh(exported, "H8");
  const streamed = `${[...iteratePreparedInpLines(prepared, options)].join("\n")}\n`;
  const text = refinementSessionExportToInp(exported, options);

  assert.equal(streamed, text);
});

test("HexRefine project INP export includes automatic boundary element and node sets", () => {
  const exported = buildRefinementSessionExport(createRefinementSession(createHexUnitCubeMesh(1, 1, 1)), {
    mergeNodes: true
  });
  const inp = refinementSessionExportToInp(exported, { title: "boundary sets" });
  const sides = ["XMIN", "XMAX", "YMIN", "YMAX", "ZMIN", "ZMAX"];

  for (const side of sides) {
    assert.deepEqual(inpSetIds(inp, "Elset", `AUTO_BND_${side}_1_EL`), [1]);
    assert.equal(inpSetIds(inp, "Nset", `AUTO_BND_${side}_1_N`).length, 4);
  }
});

test("HexRefine project INP boundary sets split disconnected boundary components", () => {
  const mesh = {
    kind: "H1",
    nodes: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
      [3, 0, 0],
      [4, 0, 0],
      [4, 1, 0],
      [3, 1, 0],
      [3, 0, 1],
      [4, 0, 1],
      [4, 1, 1],
      [3, 1, 1]
    ],
    elements: [
      [1, 2, 3, 4, 5, 6, 7, 8],
      [9, 10, 11, 12, 13, 14, 15, 16]
    ]
  };
  const exported = buildRefinementSessionExport(createRefinementSession(mesh), {
    mergeNodes: true
  });
  const inp = refinementSessionExportToInp(exported, { title: "disconnected boundary sets" });

  assert.deepEqual(inpSetIds(inp, "Elset", "AUTO_BND_XMIN_1_EL"), [1]);
  assert.deepEqual(inpSetIds(inp, "Elset", "AUTO_BND_XMIN_2_EL"), [2]);
  assert.equal(inpSetIds(inp, "Nset", "AUTO_BND_XMIN_1_N").length, 4);
  assert.equal(inpSetIds(inp, "Nset", "AUTO_BND_XMIN_2_N").length, 4);
});

test("HexRefine project streams native session VTK and INP without materializing flat elements", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const sets = {
    cellSets: new Map([["LEFT", ["e1"]]]),
    nodeSets: new Map([["CORNER", [1, 2]]])
  };
  const exported = buildRefinementSessionExport(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9,
    sets
  });
  const prepared = prepareExportMesh(exported, "H8");
  const plan = buildNativeSessionExportPlan(session, {
    mergeTolerance: 1e-9,
    sets
  });
  const vtkOptions = { title: "HexRefine native session VTK smoke" };
  const inpOptions = { title: "HexRefine native session INP smoke" };

  const flatVtk = `${[...iterateLegacyVtkLines(prepared.mesh, vtkOptions)].join("\n")}\n`;
  const nativeVtk = `${[...iterateNativeSessionVtkLines(plan, vtkOptions)].join("\n")}\n`;
  const flatInp = `${[...iteratePreparedInpLines(prepared, inpOptions)].join("\n")}\n`;
  const nativeInp = `${[...iterateNativeSessionInpLines(plan, inpOptions)].join("\n")}\n`;

  assert.equal(nativeVtk, flatVtk);
  assert.equal(nativeInp, flatInp);
  assert.equal(plan.activeCellIds.length, 2);
});

test("HexRefine project converts Q1 export meshes to T3 and Q9 before writing", () => {
  const exported = {
    mesh: {
      kind: "Q1",
      nodes: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1]
      ],
      elements: [[1, 2, 3, 4]]
    },
    build: null,
    sets: {
      cellSets: new Map([["FACE", [1]]]),
      nodeSets: new Map([["EDGE", [1, 2]]]),
      missingCellIdsBySet: new Map(),
      missingNodeIdsBySet: new Map()
    }
  };

  const triangles = prepareExportMesh(exported, "T3");
  assert.equal(triangles.mesh.kind, "T3");
  assert.equal(triangles.mesh.elements.length, 2);
  assert.deepEqual(triangles.mesh.elements[0], [1, 2, 3]);
  assert.deepEqual(triangles.mesh.elements[1], [1, 3, 4]);
  assert.deepEqual(triangles.sets.cellSets.get("FACE"), [1, 2]);

  const q9 = prepareExportMesh(exported, "Q9");
  assert.equal(q9.mesh.kind, "Q9");
  assert.equal(q9.mesh.nodes.length, 9);
  assert.equal(q9.mesh.elements[0].length, 9);
  assert.deepEqual(q9.sets.cellSets.get("FACE"), [1]);
  assert.deepEqual(q9.sets.nodeSets.get("EDGE"), [1, 2]);
});

test("HexRefine project converts H1 export meshes to H20 before writing", () => {
  const exported = {
    mesh: {
      kind: "H1",
      nodes: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
        [0, 0, 1],
        [1, 0, 1],
        [1, 1, 1],
        [0, 1, 1]
      ],
      elements: [[1, 2, 3, 4, 5, 6, 7, 8]]
    },
    build: null,
    sets: {
      cellSets: new Map([["VOL", [1]]]),
      nodeSets: new Map(),
      missingCellIdsBySet: new Map(),
      missingNodeIdsBySet: new Map()
    }
  };

  const h20 = prepareExportMesh(exported, "H20");
  assert.equal(h20.mesh.kind, "H20");
  assert.equal(h20.mesh.nodes.length, 20);
  assert.equal(h20.mesh.elements[0].length, 20);
  assert.deepEqual(h20.sets.cellSets.get("VOL"), [1]);

  const h20Inp = `${[...iteratePreparedInpLines(h20, { title: "H20 boundary sets" })].join("\n")}\n`;
  assert.deepEqual(inpSetIds(h20Inp, "Elset", "AUTO_BND_ZMIN_1_EL"), [1]);
  assert.equal(inpSetIds(h20Inp, "Nset", "AUTO_BND_ZMIN_1_N").length, 8);
});

test("HexRefine project reports user-friendly unsupported VTK cell type errors", () => {
  const unsupportedVtk = [
    "# vtk DataFile Version 3.0",
    "triangle",
    "ASCII",
    "DATASET UNSTRUCTURED_GRID",
    "POINTS 3 double",
    "0 0 0",
    "1 0 0",
    "0 1 0",
    "CELLS 1 4",
    "3 0 1 2",
    "CELL_TYPES 1",
    "5"
  ].join("\n");

  assert.throws(
    () => parseMeshText(unsupportedVtk, "triangle.vtk"),
    /supports CELL_TYPES 9 \(QUAD\) and 12 \(HEXAHEDRON\)/i
  );
});

test("HexRefine project hanging-node check handles highly nonuniform face scales", () => {
  const largeHex = {
    nodes: [
      [0, 0, 0],
      [1000000, 0, 0],
      [1000000, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1000000, 0, 1],
      [1000000, 1, 1],
      [0, 1, 1]
    ],
    elements: [[1, 2, 3, 4, 5, 6, 7, 8]]
  };
  const tinyHexes = Array.from({ length: 16 }, (_, index) => {
    const offset = 10 + index * 2;
    const nodeBase = 8 + index * 8;
    const nodes = [
      [offset, 10, 10],
      [offset + 1, 10, 10],
      [offset + 1, 11, 10],
      [offset, 11, 10],
      [offset, 10, 11],
      [offset + 1, 10, 11],
      [offset + 1, 11, 11],
      [offset, 11, 11]
    ];
    const element = Array.from({ length: 8 }, (_, localIndex) => nodeBase + localIndex + 1);
    return { nodes, element };
  });
  const mesh = {
    kind: "H1",
    nodes: [
      ...largeHex.nodes,
      ...tinyHexes.flatMap((item) => item.nodes)
    ],
    elements: [
      ...largeHex.elements,
      ...tinyHexes.map((item) => item.element)
    ]
  };

  const report = checkNoHangingNodes(mesh, 1e-8);

  assert.equal(report.ok, true);
  assert.equal(report.hanging.length, 0);
});

test("HexRefine project can directly refine a local Hex on a non-block imported mesh", () => {
  const base = createHexUnitCubeMesh(3, 1, 2);
  const mesh = {
    kind: "H1",
    nodes: base.nodes,
    elements: base.elements.filter((_, index) => index !== 4)
  };

  const result = refinementOps.refineByElementIdsWithReport(mesh, [1], {
    includeTransitions: true,
    regularizeHexSelection: false
  });

  assert.ok(result.mesh.elements.length > mesh.elements.length);
  assert.equal(checkNoHangingNodes(result.mesh, 1e-8).ok, true);
});

test("HexRefine project exports refined sessions to VTK and INP", () => {
  const replay = replayHexRefineCommandScript({
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 2,
          ny: 2,
          nz: 2,
          bounds: { min: [0, 0, 0], max: [1, 1, 1] }
        }
      },
      {
        kind: "refine.patch",
        payload: {
          elementIds: [1],
          options: { includeTransitions: true }
        }
      },
      {
        kind: "set.cells.save",
        payload: {
          name: "CORE",
          elementIds: [1],
          material: { name: "steel", elasticModulus: 210000, poissonRatio: 0.3 }
        }
      }
    ]
  });

  const exported = buildRefinementSessionExport(replay.session, {
    sets: {
      cellSets: replay.cellSets,
      nodeSets: replay.nodeSets
    },
    mergeNodes: true,
    mergeTolerance: 1e-8
  });
  const vtk = meshToLegacyVtk(exported.mesh, { title: "HexRefine project export" });
  const inp = refinementSessionExportToInp(exported, {
    title: "HexRefine project export",
    materials: replay.cellSetMaterials
  });

  assert.match(vtk, /DATASET UNSTRUCTURED_GRID/);
  assert.match(inp, /\*Node/);
  assert.match(inp, /\*Element/);
  assert.match(inp, /\*Elset, elset=CORE/);
  assert.match(inp, /\*Material, name=steel/);
});
