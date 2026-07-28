import { readFileSync, writeFileSync } from "node:fs";
import {
  checkNoHangingNodes,
  createHexUnitCubeMesh,
  meshToLsdynaKeyword,
  parseMeshText,
  refineByElementIdsWithReport
} from "../dist/index.js";

const fixtures = [
  {
    name: "tension-gauge-slab",
    mesh: parseMeshText(
      readFileSync(
        new URL(
          "../test/fixtures/lsdyna/real-ogrid-gauge-slab.k",
          import.meta.url
        ),
        "utf8"
      ),
      "real-ogrid-gauge-slab.k"
    ),
    select: (mesh) => mesh.elements
      .map((element, index) => ({
        elementId: index + 1,
        y: averageCoordinate(mesh, element, 1)
      }))
      .filter(({ y }) => Math.abs(y) < 0.06)
      .map(({ elementId }) => elementId),
    options: {
      hexRefinementRatio: 2,
      regularizeHexSelection: false
    },
    expectedStatus: "direct",
    minimumScaledJacobian: 0.25
  },
  {
    name: "compression-ogrid-ring",
    mesh: createFixtureButterflyOgridBar(6),
    select: () => Array.from(
      { length: 24 },
      (_, index) => 25 + index
    ),
    options: {
      hexRefinementRatio: 2,
      regularizeHexSelection: false
    },
    expectedStatus: "direct",
    minimumScaledJacobian: 0.08
  },
  {
    name: "double-shear-contact-shell",
    mesh: createFixtureDoubleShearBlock(),
    select: () => [
      ...idsInIndexBlock(9, 7, 3, [2, 1, 1], [3, 2, 1]),
      ...idsInIndexBlock(9, 7, 3, [5, 4, 1], [6, 5, 1])
    ],
    options: {
      hexRefinementRatio: 2,
      hexTwoToOneSelectionMode: "local",
      regularizeHexSelection: false
    },
    expectedStatus: "direct",
    minimumScaledJacobian: 0.12
  }
];

for (const fixture of fixtures) {
  const selectedElementIds = fixture.select(fixture.mesh);
  const result = refineByElementIdsWithReport(
    fixture.mesh,
    selectedElementIds,
    fixture.options
  );
  if (
    !result.quality?.ok
    || result.quality.childMinimumOrientedScaledJacobian
      < fixture.minimumScaledJacobian
    || !checkNoHangingNodes(result.mesh, 1e-8).ok
    || result.twoToOne?.status !== fixture.expectedStatus
  ) {
    throw new Error(`${fixture.name} failed its generation audit`);
  }
  const keyword = meshToLsdynaKeyword(fixture.mesh, { partId: 1 });
  assertMeshOnlyKeyword(keyword);
  const manifest = {
    selectedElementIds,
    options: fixture.options,
    expectedStatus: fixture.expectedStatus,
    expectedInputNodeCount: fixture.mesh.nodes.length,
    expectedInputElementCount: fixture.mesh.elements.length,
    expectedOutputNodeCount: result.mesh.nodes.length,
    expectedOutputElementCount: result.mesh.elements.length,
    minimumScaledJacobian: fixture.minimumScaledJacobian
  };
  writeFileSync(
    new URL(
      `../test/fixtures/lsdyna/${fixture.name}.k`,
      import.meta.url
    ),
    keyword
  );
  writeFileSync(
    new URL(
      `../test/fixtures/lsdyna/${fixture.name}.json`,
      import.meta.url
    ),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}

function createFixtureButterflyOgridBar(layers) {
  const ringTheta = Array.from(
    { length: 8 },
    (_, step) => Math.PI * (0.25 + 0.25 * step)
  );
  const centerRing = [
    [0.5, 0.5],
    [0, 0.5],
    [-0.5, 0.5],
    [-0.5, 0],
    [-0.5, -0.5],
    [0, -0.5],
    [0.5, -0.5],
    [0.5, 0]
  ];
  const sectionPoints = [
    [0, 0],
    ...centerRing,
    ...ringTheta.map((theta) => [Math.cos(theta), Math.sin(theta)])
  ];
  const quads = [
    [0, 8, 1, 2],
    [0, 2, 3, 4],
    [0, 4, 5, 6],
    [0, 6, 7, 8],
    ...Array.from({ length: 8 }, (_, side) => [
      1 + ((side + 1) % 8),
      1 + side,
      9 + side,
      9 + ((side + 1) % 8)
    ])
  ];
  const nodes = [];
  for (let layer = 0; layer <= layers; layer += 1) {
    for (const [x, y] of sectionPoints) {
      nodes.push([x, y, layer]);
    }
  }
  const stride = sectionPoints.length;
  const elements = [];
  for (let layer = 0; layer < layers; layer += 1) {
    for (const quad of quads) {
      elements.push([
        ...quad.map((node) => layer * stride + node + 1),
        ...quad.map((node) => (layer + 1) * stride + node + 1)
      ]);
    }
  }
  return { kind: "H1", nodes, elements };
}

function createFixtureDoubleShearBlock() {
  const base = createHexUnitCubeMesh(9, 7, 3);
  return {
    ...base,
    nodes: base.nodes.map(([x, y, z]) => [
      x + 0.08 * Math.sin(Math.PI * y) * (z - 0.5),
      y + 0.04 * Math.sin(2 * Math.PI * x),
      0.2 * z + 0.02 * x * y
    ])
  };
}

function averageCoordinate(mesh, element, axis) {
  return element.reduce(
    (total, nodeId) => total + mesh.nodes[nodeId - 1][axis],
    0
  ) / element.length;
}

function elementIdAt(nx, ny, i, j, k) {
  return k * nx * ny + j * nx + i + 1;
}

function idsInIndexBlock(nx, ny, _nz, min, max) {
  const ids = [];
  for (let k = min[2]; k <= max[2]; k += 1) {
    for (let j = min[1]; j <= max[1]; j += 1) {
      for (let i = min[0]; i <= max[0]; i += 1) {
        ids.push(elementIdAt(nx, ny, i, j, k));
      }
    }
  }
  return ids;
}

function assertMeshOnlyKeyword(keyword) {
  const keywords = keyword
    .split(/\r?\n/)
    .map((line) => line.trim().toUpperCase())
    .filter((line) => line.startsWith("*"));
  if (
    keywords.join("|")
    !== "*KEYWORD|*NODE|*ELEMENT_SOLID|*END"
  ) {
    throw new Error(`fixture contains non-mesh keywords: ${keywords}`);
  }
}
