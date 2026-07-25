import type { Element } from "./types.js";
import {
  properCubeRotations,
  type ReferencePoint3
} from "./two-to-one-templates.js";

export type MarkedCornerSignature = string;

export interface RegularSweepTemplate {
  name: "pattern1" | "pattern2" | "pattern4" | "uniform8";
  nodes: readonly ReferencePoint3[];
  elements: readonly Element[];
  markedCorners: readonly ReferencePoint3[];
}

const CORNER_SIGNS: readonly ReferencePoint3[] = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1]
];

const CANONICAL_TEMPLATES: readonly RegularSweepTemplate[] = [
  template(
    "pattern1",
    [
      [-1, -1, 1], [-1, -1, -1], [0, 0, -1], [0, 0, 0],
      [-1, 1, -1], [0, 1, -1], [0, 1, 0], [-1, 1, 1],
      [1, -1, -1], [1, 0, -1], [1, 0, 0], [1, -1, 1],
      [1, 1, -1], [1, 1, 0], [1, 1, 1]
    ],
    [
      [1, 2, 3, 4, 12, 9, 10, 11],
      [1, 4, 3, 2, 8, 7, 6, 5],
      [4, 7, 8, 1, 11, 14, 15, 12],
      [3, 6, 7, 4, 10, 13, 14, 11]
    ],
    [[1, 1, -1]]
  ),
  template(
    "pattern2",
    [
      [1, 0, 0], [-1, 0, 0], [-1, 1, 1], [1, 1, 1],
      [-1, -1, -1], [-1, 0, -1], [-1, -1, 0], [1, -1, -1],
      [1, 0, -1], [1, -1, 0], [-1, -1, 1], [1, -1, 1],
      [-1, 1, -1], [1, 1, -1]
    ],
    [
      [1, 2, 3, 4, 9, 6, 13, 14],
      [1, 4, 3, 2, 10, 12, 11, 7],
      [5, 6, 2, 7, 8, 9, 1, 10]
    ],
    [[-1, -1, -1], [1, -1, -1]]
  ),
  template(
    "pattern4",
    [
      [-1, -1, 1], [-1, 1, 1], [1, 1, 1], [1, -1, 1],
      [-1, -1, 0], [-1, 1, 0], [1, 1, 0], [1, -1, 0],
      [-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]
    ],
    [
      [1, 2, 3, 4, 5, 6, 7, 8],
      [5, 6, 7, 8, 9, 10, 11, 12]
    ],
    [[-1, -1, 1], [-1, 1, 1], [1, -1, 1], [1, 1, 1]]
  ),
  template(
    "uniform8",
    [
      [-1, -1, -1], [0, -1, -1], [0, 0, -1], [-1, 0, -1],
      [-1, -1, 0], [0, -1, 0], [0, 0, 0], [-1, 0, 0],
      [1, -1, -1], [1, 0, -1], [1, -1, 0], [1, 0, 0],
      [0, 1, -1], [-1, 1, -1], [0, 1, 0], [-1, 1, 0],
      [1, 1, -1], [1, 1, 0], [-1, -1, 1], [0, -1, 1],
      [0, 0, 1], [-1, 0, 1], [1, -1, 1], [1, 0, 1],
      [0, 1, 1], [-1, 1, 1], [1, 1, 1]
    ],
    [
      [1, 2, 3, 4, 5, 6, 7, 8],
      [2, 9, 10, 3, 6, 11, 12, 7],
      [4, 3, 13, 14, 8, 7, 15, 16],
      [3, 10, 17, 13, 7, 12, 18, 15],
      [5, 6, 7, 8, 19, 20, 21, 22],
      [6, 11, 12, 7, 20, 23, 24, 21],
      [8, 7, 15, 16, 22, 21, 25, 26],
      [7, 12, 18, 15, 21, 24, 27, 25]
    ],
    CORNER_SIGNS
  )
];

let cachedLibrary: ReadonlyMap<MarkedCornerSignature, RegularSweepTemplate> | undefined;

export function regularSweepTemplateLibrary(): ReadonlyMap<
  MarkedCornerSignature,
  RegularSweepTemplate
> {
  if (cachedLibrary) {
    return cachedLibrary;
  }
  const library = new Map<MarkedCornerSignature, RegularSweepTemplate>();
  for (const canonical of CANONICAL_TEMPLATES) {
    for (const rotation of properCubeRotations()) {
      const markedCorners = canonical.markedCorners.map((point) =>
        multiplyMatrixPoint(rotation, point)
      );
      const signature = markedCornerSignature(markedCorners);
      if (library.has(signature)) {
        continue;
      }
      library.set(signature, {
        name: canonical.name,
        nodes: canonical.nodes.map((point) => multiplyMatrixPoint(rotation, point)),
        elements: canonical.elements,
        markedCorners
      });
    }
  }
  cachedLibrary = library;
  return cachedLibrary;
}

export function markedCornerSignature(
  markedCorners: readonly ReferencePoint3[]
): MarkedCornerSignature {
  return markedCorners
    .map((point) => point.join(","))
    .sort()
    .join("|");
}

export function regularSweepCornerSigns(): readonly ReferencePoint3[] {
  return CORNER_SIGNS;
}

function template(
  name: RegularSweepTemplate["name"],
  nodes: readonly ReferencePoint3[],
  oneBasedElements: readonly Element[],
  markedCorners: readonly ReferencePoint3[]
): RegularSweepTemplate {
  return {
    name,
    nodes,
    elements: oneBasedElements.map((element) => element.map((nodeId) => nodeId - 1)),
    markedCorners
  };
}

function multiplyMatrixPoint(
  matrix: readonly (readonly number[])[],
  point: ReferencePoint3
): ReferencePoint3 {
  return [0, 1, 2].map((row) =>
    matrix[row]!.reduce((total, value, column) => total + value * point[column]!, 0)
  ) as [number, number, number];
}
