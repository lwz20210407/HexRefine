import type { Element, LocalRefinement, Point } from "./types.js";
import { mix } from "./vector.js";

export type ReferencePoint3 = readonly [number, number, number];

export interface TwoWay7ReferenceTemplate {
  name: string;
  nodes: readonly ReferencePoint3[];
  elements: readonly Element[];
}

const BASE_NODES: readonly ReferencePoint3[] = [
  [0, 0, 0],
  [0, 0, 1],
  [0, 0.5, 0.5],
  [0, 0.5, 1],
  [0, 1, 0],
  [0, 1, 0.5],
  [0, 1, 1],
  [0.5, 0, 0.5],
  [0.5, 0, 1],
  [0.5, 0.5, 0.75],
  [0.5, 0.5, 1],
  [0.5, 1, 0.5],
  [0.5, 1, 0.75],
  [0.5, 1, 1],
  [1, 0, 0],
  [1, 0, 0.5],
  [1, 0, 1],
  [1, 0.5, 0.75],
  [1, 0.5, 1],
  [1, 1, 0],
  [1, 1, 0.5],
  [1, 1, 0.75],
  [1, 1, 1]
];

const BASE_ELEMENTS: readonly Element[] = [
  [0, 7, 9, 2, 1, 8, 10, 3],
  [0, 7, 11, 4, 2, 9, 12, 5],
  [7, 15, 17, 9, 8, 16, 18, 10],
  [2, 9, 12, 5, 3, 10, 13, 6],
  [0, 14, 19, 4, 7, 15, 20, 11],
  [9, 17, 21, 12, 10, 18, 22, 13],
  [7, 15, 20, 11, 9, 17, 21, 12]
];

const SQUARE_TRANSFORMS = [
  { label: "A", matrix: [[1, 0], [0, 1]], offset: [0, 0] },
  { label: "B", matrix: [[-1, 0], [0, 1]], offset: [1, 0] },
  { label: "C", matrix: [[-1, 0], [0, -1]], offset: [1, 1] },
  { label: "D", matrix: [[1, 0], [0, -1]], offset: [0, 1] },
  { label: "E", matrix: [[0, 1], [1, 0]], offset: [0, 0] },
  { label: "F", matrix: [[0, -1], [1, 0]], offset: [1, 0] },
  { label: "G", matrix: [[0, -1], [-1, 0]], offset: [1, 1] },
  { label: "H", matrix: [[0, 1], [-1, 0]], offset: [0, 1] }
] as const;

const REFLECTED_LOCAL_ORDER = [0, 3, 2, 1, 4, 7, 6, 5] as const;

let cachedTemplates: readonly TwoWay7ReferenceTemplate[] | undefined;

/**
 * TrueGrid-derived single-parent 4-to-2 transition family.
 *
 * Coordinates use the HexRefine reference cube [-1, 1]^3. The z=-1 face is
 * coarse and z=1 is split 2-by-2. All eight square symmetries are retained
 * because neighboring transition columns need complementary wall partitions.
 */
export function twoWay7ReferenceTemplates(): readonly TwoWay7ReferenceTemplate[] {
  if (cachedTemplates) {
    return cachedTemplates;
  }
  cachedTemplates = SQUARE_TRANSFORMS.map(({ label, matrix, offset }) => {
    const determinant = matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];
    const nodes = BASE_NODES.map(([u, v, w]) => {
      const transformedU = matrix[0][0] * u + matrix[0][1] * v + offset[0];
      const transformedV = matrix[1][0] * u + matrix[1][1] * v + offset[1];
      return [
        2 * transformedU - 1,
        2 * transformedV - 1,
        2 * w - 1
      ] as ReferencePoint3;
    });
    const elements = BASE_ELEMENTS.map((element) => {
      const oriented = determinant < 0
        ? REFLECTED_LOCAL_ORDER.map((local) => element[local]!)
        : [...element];
      return oriented;
    });
    return {
      name: `two_way7_${label.toLowerCase()}`,
      nodes,
      elements
    };
  });
  return cachedTemplates;
}

export function rotateTwoWay7Template(
  template: TwoWay7ReferenceTemplate,
  matrix: readonly (readonly number[])[]
): TwoWay7ReferenceTemplate {
  return {
    name: template.name,
    nodes: template.nodes.map((point) => multiplyMatrixPoint(matrix, point)),
    elements: template.elements
  };
}

export function instantiateTwoWay7Template(
  vertices: readonly Point[],
  template: TwoWay7ReferenceTemplate,
  source = template.name
): LocalRefinement {
  if (vertices.length !== 8) {
    throw new Error(`H1/Hex refinement requires 8 vertices, got ${vertices.length}`);
  }
  return {
    kind: "H1",
    source,
    nodes: template.nodes.map((point) => mapReferencePoint(vertices, point)),
    elements: template.elements.map((element) => element.map((nodeId) => nodeId + 1)),
  };
}

export function properCubeRotations(): readonly (readonly (readonly number[])[])[] {
  const matrices: number[][][] = [];
  for (const permutation of permutations([0, 1, 2])) {
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const signs = [sx, sy, sz];
          const matrix = Array.from({ length: 3 }, () => [0, 0, 0]);
          for (let row = 0; row < 3; row += 1) {
            matrix[row]![permutation[row]!] = signs[row]!;
          }
          if (determinant3(matrix) === 1) {
            matrices.push(matrix);
          }
        }
      }
    }
  }
  return matrices;
}

function mapReferencePoint(vertices: readonly Point[], reference: ReferencePoint3): Point {
  const u = (reference[0] + 1) / 2;
  const v = (reference[1] + 1) / 2;
  const w = (reference[2] + 1) / 2;
  return mix(vertices, [
    (1 - u) * (1 - v) * (1 - w),
    u * (1 - v) * (1 - w),
    u * v * (1 - w),
    (1 - u) * v * (1 - w),
    (1 - u) * (1 - v) * w,
    u * (1 - v) * w,
    u * v * w,
    (1 - u) * v * w
  ]);
}

function multiplyMatrixPoint(
  matrix: readonly (readonly number[])[],
  point: ReferencePoint3
): ReferencePoint3 {
  return [0, 1, 2].map((row) =>
    matrix[row]!.reduce((total, value, column) => total + value * point[column]!, 0)
  ) as [number, number, number];
}

function determinant3(matrix: readonly (readonly number[])[]): number {
  const [a, b, c] = matrix;
  return Math.round(
    a![0]! * (b![1]! * c![2]! - b![2]! * c![1]!) -
    a![1]! * (b![0]! * c![2]! - b![2]! * c![0]!) +
    a![2]! * (b![0]! * c![1]! - b![1]! * c![0]!)
  );
}

function permutations(values: readonly number[]): number[][] {
  if (values.length <= 1) {
    return [[...values]];
  }
  const result: number[][] = [];
  values.forEach((value, index) => {
    const rest = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const suffix of permutations(rest)) {
      result.push([value, ...suffix]);
    }
  });
  return result;
}
