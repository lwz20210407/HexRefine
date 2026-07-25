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

export type Pattern3SymbolKind = "corner" | "edge" | "face";

export interface Pattern3Symbol {
  kind: Pattern3SymbolKind;
  corners: readonly number[];
}

export interface Pattern3Half {
  name: "pattern3pair";
  markedCorners: readonly ReferencePoint3[];
  faceCorners: readonly number[];
  children: readonly (readonly Pattern3Symbol[])[];
  mergeGroups: readonly (readonly Pattern3Symbol[])[];
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
let cachedPattern3Library: ReadonlyMap<MarkedCornerSignature, Pattern3Half> | undefined;

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

export function pattern3PairTemplateLibrary(): ReadonlyMap<
  MarkedCornerSignature,
  Pattern3Half
> {
  if (cachedPattern3Library) {
    return cachedPattern3Library;
  }
  const canonicalMarks = [0, 2, 3] as const;
  const canonicalChildren: readonly (readonly Pattern3Symbol[])[] = [
    [
      symbol("corner", [0]), symbol("edge", [1, 2]),
      symbol("corner", [2]), symbol("corner", [3]),
      symbol("edge", [0, 4]), symbol("face", [1, 2, 5, 6]),
      symbol("edge", [2, 6]), symbol("edge", [3, 7])
    ],
    [
      symbol("edge", [0, 4]), symbol("face", [1, 2, 5, 6]),
      symbol("edge", [2, 6]), symbol("edge", [3, 7]),
      symbol("corner", [4]), symbol("corner", [5]),
      symbol("corner", [6]), symbol("corner", [7])
    ]
  ];
  const canonicalMerges: readonly (readonly Pattern3Symbol[])[] = [
    [symbol("edge", [0, 1]), symbol("edge", [1, 2])],
    [symbol("face", [0, 1, 4, 5]), symbol("face", [1, 2, 5, 6])]
  ];
  const library = new Map<MarkedCornerSignature, Pattern3Half>();
  for (const rotation of properCubeRotations()) {
    const permutation = CORNER_SIGNS.map((corner) => {
      const rotated = multiplyMatrixPoint(rotation, corner);
      const index = CORNER_SIGNS.findIndex((candidate) =>
        candidate.every((value, axis) => value === rotated[axis])
      );
      if (index < 0) {
        throw new Error("proper cube rotation did not map to an H1 corner");
      }
      return index;
    });
    const relabel = (item: Pattern3Symbol): Pattern3Symbol => ({
      kind: item.kind,
      corners: item.corners.map((corner) => permutation[corner]!).sort((a, b) => a - b)
    });
    const markedCornerIds = canonicalMarks.map((corner) => permutation[corner]!);
    const markedCorners = markedCornerIds.map((corner) => CORNER_SIGNS[corner]!);
    const signature = markedCornerSignature(markedCorners);
    if (library.has(signature)) {
      throw new Error(`duplicate pattern-3 marked-corner signature ${signature}`);
    }
    library.set(signature, {
      name: "pattern3pair",
      markedCorners,
      faceCorners: [0, 1, 2, 3].map((corner) => permutation[corner]!).sort((a, b) => a - b),
      children: canonicalChildren.map((child) => child.map(relabel)),
      mergeGroups: canonicalMerges.map((group) => group.map(relabel))
    });
  }
  cachedPattern3Library = library;
  return cachedPattern3Library;
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

function symbol(
  kind: Pattern3SymbolKind,
  corners: readonly number[]
): Pattern3Symbol {
  return { kind, corners };
}

function multiplyMatrixPoint(
  matrix: readonly (readonly number[])[],
  point: ReferencePoint3
): ReferencePoint3 {
  return [0, 1, 2].map((row) =>
    matrix[row]!.reduce((total, value, column) => total + value * point[column]!, 0)
  ) as [number, number, number];
}
