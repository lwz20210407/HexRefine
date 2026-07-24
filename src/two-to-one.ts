import type { Element, LocalRefinement, Mesh, ReplaceElement } from "./types.js";
import { elementVertices } from "./mesh.js";
import { H1_FACES, boundaryKey } from "./topology.js";
import { refineHexTo8Hex } from "./templates.js";
import {
  instantiateTwoWay7Template,
  properCubeRotations,
  rotateTwoWay7Template,
  twoWay7ReferenceTemplates,
  type ReferencePoint3,
  type TwoWay7ReferenceTemplate
} from "./two-to-one-templates.js";

export interface TwoToOneReplacement extends ReplaceElement {
  role: "selected" | "face-transition";
  templateCode: 7 | 8;
}

interface FaceOwner {
  elementId: number;
  face: number;
}

interface TransitionCell {
  elementId: number;
  innerFace: number;
  outerFace: number;
}

interface Candidate {
  name: string;
  template: TwoWay7ReferenceTemplate;
  partitions: readonly LocalPartition[];
  boundaryEdges: readonly LocalBoundaryEdges[];
}

interface InterfaceConstraint {
  first: number;
  firstFace: number;
  second: number;
  secondFace: number;
}

type LocalChildFace = readonly ReferencePoint3[];
type LocalPartition = readonly LocalChildFace[];
type LocalEdge = readonly [ReferencePoint3, ReferencePoint3];
type LocalBoundaryEdges = readonly LocalEdge[];

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

const OPPOSITE_FACE = [1, 0, 3, 2, 5, 4] as const;
let candidateCache: readonly Candidate[] | undefined;

/**
 * Build a conforming 2:1 refinement for a full extruded section.
 *
 * The selected core is replaced once by uniform 1-to-8 subdivisions. One
 * neighboring parent layer per internal interface is replaced by TrueGrid's
 * seven-hex 4-to-2 template. Candidate orientations are solved globally so
 * lateral wall partitions and exposed-boundary phases close around O-grids.
 */
export function buildTwoToOneHexReplacements(
  mesh: Mesh,
  selectedElementIds: readonly number[]
): TwoToOneReplacement[] {
  const selected = uniqueSorted(selectedElementIds);
  const selectedSet = new Set(selected);
  const incidence = buildFaceIncidence(mesh);
  const cells = discoverTransitionCells(mesh, selectedSet, incidence);
  const variables = cells.map((cell) => cell.elementId);
  const variableIndex = new Map(variables.map((elementId, index) => [elementId, index]));
  const candidates = twoWayCandidates();
  const partitionSignatures = candidates.map((candidate) =>
    candidate.partitions.map(localPartitionSignature)
  );
  const partitionCache = new Map<string, string>();

  const partition = (variable: number, face: number, candidate: number): string => {
    const key = `${variable}:${face}:${partitionSignatures[candidate]![face]}`;
    const cached = partitionCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const element = mesh.elements[variables[variable]! - 1]!;
    const value = globalPartition(element, candidates[candidate]!.partitions[face]!);
    partitionCache.set(key, value);
    return value;
  };

  const domains: Array<Set<number>> = cells.map((cell, variable) => {
    const allowed = new Set<number>();
    candidates.forEach((candidate, candidateId) => {
      if (
        candidate.partitions[cell.innerFace]!.length !== 4
        || candidate.partitions[cell.outerFace]!.length !== 1
      ) {
        return;
      }
      allowed.add(candidateId);
    });
    if (allowed.size === 0) {
      throw new Error(`element ${cell.elementId} has no oriented 2:1 seven-hex candidate`);
    }
    return allowed;
  });

  const {
    constraints,
    externalFaces
  } = buildTransitionConstraints(
    mesh,
    selectedSet,
    cells,
    variableIndex,
    incidence
  );
  const components = constraintComponents(variables.length, constraints);
  const solution = solveLevelField(
    cells,
    candidates,
    domains,
    constraints,
    externalFaces,
    components,
    partition
  );
  if (!solution) {
    throw new Error(
      "no level-closed 2:1 seven-hex transition field exists; " +
      "the interface may have odd periodic parity or unsupported topology"
    );
  }

  const replacements: TwoToOneReplacement[] = selected.map((elementId) => ({
    elementId,
    refinement: refineHexTo8Hex(elementVertices(mesh, mesh.elements[elementId - 1]!)),
    role: "selected",
    templateCode: 8
  }));
  solution.forEach((candidateId, variable) => {
    const elementId = variables[variable]!;
    const candidate = candidates[candidateId]!;
    replacements.push({
      elementId,
      refinement: instantiateTwoWay7Template(
        elementVertices(mesh, mesh.elements[elementId - 1]!),
        candidate.template,
        candidate.name
      ),
      role: "face-transition",
      templateCode: 7
    });
  });
  return replacements;
}

function discoverTransitionCells(
  mesh: Mesh,
  selected: ReadonlySet<number>,
  incidence: ReadonlyMap<string, readonly FaceOwner[]>
): TransitionCell[] {
  const cellsByElement = new Map<number, TransitionCell>();
  for (const owners of incidence.values()) {
    if (owners.length !== 2) {
      continue;
    }
    const [first, second] = owners;
    if (!first || !second || selected.has(first.elementId) === selected.has(second.elementId)) {
      continue;
    }
    const selectedOwner = selected.has(first.elementId) ? first : second;
    const transitionOwner = selected.has(first.elementId) ? second : first;
    if (cellsByElement.has(transitionOwner.elementId)) {
      throw new Error(
        `2:1 transition columns overlap at element ${transitionOwner.elementId}; ` +
        "intersecting face-transition shells require dedicated edge/corner templates"
      );
    }
    cellsByElement.set(transitionOwner.elementId, {
      elementId: transitionOwner.elementId,
      innerFace: transitionOwner.face,
      outerFace: OPPOSITE_FACE[transitionOwner.face]!
    });
  }
  if (cellsByElement.size === 0) {
    return [];
  }
  return [...cellsByElement.values()].sort((a, b) => a.elementId - b.elementId);
}

function buildTransitionConstraints(
  mesh: Mesh,
  selected: ReadonlySet<number>,
  cells: readonly TransitionCell[],
  variableIndex: ReadonlyMap<number, number>,
  incidence: ReadonlyMap<string, readonly FaceOwner[]>
): {
  constraints: InterfaceConstraint[];
  externalFaces: Map<number, number[]>;
} {
  const constraints: InterfaceConstraint[] = [];
  const externalFaces = new Map<number, number[]>();
  const seenInterfaces = new Set<string>();

  cells.forEach((cell, variable) => {
    const element = mesh.elements[cell.elementId - 1]!;
    H1_FACES.forEach((faceTemplate, face) => {
      if (face === cell.innerFace || face === cell.outerFace) {
        return;
      }
      const key = boundaryKey(faceTemplate.map((localId) => element[localId - 1]!));
      const owners = incidence.get(key) ?? [];
      if (owners.length === 1) {
        const list = externalFaces.get(variable) ?? [];
        list.push(face);
        externalFaces.set(variable, list);
        return;
      }
      const other = owners.find((owner) => owner.elementId !== cell.elementId);
      if (!other) {
        return;
      }
      const otherVariable = variableIndex.get(other.elementId);
      if (otherVariable !== undefined) {
        const interfaceKey = variable < otherVariable
          ? `${variable}:${face}:${otherVariable}:${other.face}`
          : `${otherVariable}:${other.face}:${variable}:${face}`;
        if (!seenInterfaces.has(interfaceKey)) {
          seenInterfaces.add(interfaceKey);
          constraints.push({
            first: variable,
            firstFace: face,
            second: otherVariable,
            secondFace: other.face
          });
        }
        return;
      }
      const neighborKind = selected.has(other.elementId) ? "selected core" : "coarse far field";
      throw new Error(
        `2:1 seven-hex lateral face of element ${cell.elementId} meets ${neighborKind} ` +
        `element ${other.elementId}; the transition layer must cover a full section or end on a model boundary`
      );
    });

    const outerElementFace = H1_FACES[cell.outerFace]!.map((localId) => element[localId - 1]!);
    const outerOwners = incidence.get(boundaryKey(outerElementFace)) ?? [];
    if (outerOwners.length !== 2) {
      throw new Error(
        `2:1 transition element ${cell.elementId} reaches a free boundary on its coarse side`
      );
    }
  });

  return { constraints, externalFaces };
}

function solveLevelField(
  cells: readonly TransitionCell[],
  candidates: readonly Candidate[],
  sourceDomains: readonly Set<number>[],
  constraints: readonly InterfaceConstraint[],
  externalFaces: ReadonlyMap<number, readonly number[]>,
  components: readonly (readonly number[])[],
  partition: (variable: number, face: number, candidate: number) => string
): number[] | undefined {
  const phaseCache = new Map<string, string>();
  const phase = (variable: number, face: number, candidate: number): string => {
    const key = `${variable}:${face}:${candidate}`;
    const cached = phaseCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const value = referencePhaseSignature(
      candidates[candidate]!.boundaryEdges[face]!,
      cells[variable]!.outerFace
    ).join(",");
    phaseCache.set(key, value);
    return value;
  };

  const phaseOptions = components.map((component) => {
    const entries = component.flatMap((variable) =>
      (externalFaces.get(variable) ?? []).map((face) => ({ variable, face }))
    );
    if (entries.length === 0) {
      return [""];
    }
    let common: Set<string> | undefined;
    for (const entry of entries) {
      const values = new Set(
        [...sourceDomains[entry.variable]!].map((candidate) =>
          phase(entry.variable, entry.face, candidate)
        )
      );
      common = common === undefined
        ? values
        : new Set([...common].filter((value) => values.has(value)));
    }
    return [...(common ?? [])].sort();
  });
  if (phaseOptions.some((options) => options.length === 0)) {
    return undefined;
  }

  const selectComponentPhase = (
    componentIndex: number,
    domains: Array<Set<number>>
  ): number[] | undefined => {
    if (componentIndex === components.length) {
      return searchDomains(domains, constraints, partition);
    }
    const component = components[componentIndex]!;
    for (const selectedPhase of phaseOptions[componentIndex]!) {
      const branch = domains.map((domain) => new Set(domain));
      let viable = true;
      for (const variable of component) {
        const faces = externalFaces.get(variable) ?? [];
        if (faces.length === 0) {
          continue;
        }
        branch[variable] = new Set(
          [...branch[variable]!].filter((candidate) =>
            faces.every((face) => phase(variable, face, candidate) === selectedPhase)
          )
        );
        if (branch[variable]!.size === 0) {
          viable = false;
          break;
        }
      }
      if (!viable) {
        continue;
      }
      const result = selectComponentPhase(componentIndex + 1, branch);
      if (result) {
        return result;
      }
    }
    return undefined;
  };

  return selectComponentPhase(0, sourceDomains.map((domain) => new Set(domain)));
}

function searchDomains(
  sourceDomains: Array<Set<number>>,
  constraints: readonly InterfaceConstraint[],
  partition: (variable: number, face: number, candidate: number) => string
): number[] | undefined {
  const domains = sourceDomains.map((domain) => new Set(domain));
  const related = Array.from({ length: domains.length }, () => [] as number[]);
  const firstSupport: Array<Map<number, Set<number>>> = [];
  const secondSupport: Array<Map<number, Set<number>>> = [];

  constraints.forEach((constraint, constraintId) => {
    related[constraint.first]!.push(constraintId);
    related[constraint.second]!.push(constraintId);
    const firstMap = new Map<number, Set<number>>();
    const secondMap = new Map<number, Set<number>>();
    for (const first of domains[constraint.first]!) {
      const firstPartition = partition(
        constraint.first,
        constraint.firstFace,
        first
      );
      for (const second of domains[constraint.second]!) {
        if (
          firstPartition !== partition(
            constraint.second,
            constraint.secondFace,
            second
          )
        ) {
          continue;
        }
        const seconds = firstMap.get(first) ?? new Set<number>();
        seconds.add(second);
        firstMap.set(first, seconds);
        const firsts = secondMap.get(second) ?? new Set<number>();
        firsts.add(first);
        secondMap.set(second, firsts);
      }
    }
    firstSupport.push(firstMap);
    secondSupport.push(secondMap);
  });

  const trail: Array<{ variable: number; previous: Set<number> }> = [];
  const replaceDomain = (variable: number, value: Set<number>) => {
    if (!setsEqual(value, domains[variable]!)) {
      trail.push({ variable, previous: domains[variable]! });
      domains[variable] = value;
    }
  };
  const restore = (marker: number) => {
    while (trail.length > marker) {
      const entry = trail.pop()!;
      domains[entry.variable] = entry.previous;
    }
  };
  const propagate = (seedConstraints: Iterable<number>): boolean => {
    const queue = [...seedConstraints];
    const queued = new Set(queue);
    for (let offset = 0; offset < queue.length; offset += 1) {
      const constraintId = queue[offset]!;
      queued.delete(constraintId);
      const constraint = constraints[constraintId]!;
      const firstDomain = domains[constraint.first]!;
      const secondDomain = domains[constraint.second]!;
      const supportedFirst = new Set(
        [...firstDomain].filter((candidate) =>
          setsIntersect(firstSupport[constraintId]!.get(candidate), secondDomain)
        )
      );
      const supportedSecond = new Set(
        [...secondDomain].filter((candidate) =>
          setsIntersect(secondSupport[constraintId]!.get(candidate), supportedFirst)
        )
      );
      if (supportedFirst.size === 0 || supportedSecond.size === 0) {
        return false;
      }
      const changedVariables: number[] = [];
      if (!setsEqual(supportedFirst, firstDomain)) {
        replaceDomain(constraint.first, supportedFirst);
        changedVariables.push(constraint.first);
      }
      if (!setsEqual(supportedSecond, secondDomain)) {
        replaceDomain(constraint.second, supportedSecond);
        changedVariables.push(constraint.second);
      }
      for (const variable of changedVariables) {
        for (const neighborConstraint of related[variable]!) {
          if (
            neighborConstraint !== constraintId
            && !queued.has(neighborConstraint)
          ) {
            queue.push(neighborConstraint);
            queued.add(neighborConstraint);
          }
        }
      }
    }
    return true;
  };

  if (!propagate(constraints.keys())) {
    return undefined;
  }

  const supportScore = (variable: number, candidate: number): number =>
    related[variable]!.reduce((total, constraintId) => {
      const constraint = constraints[constraintId]!;
      const support = variable === constraint.first
        ? firstSupport[constraintId]!.get(candidate)
        : secondSupport[constraintId]!.get(candidate);
      const other = variable === constraint.first
        ? constraint.second
        : constraint.first;
      return total + intersectionSize(support, domains[other]!);
    }, 0);

  const searchComponent = (component: readonly number[]): boolean => {
    const unresolved = component
      .filter((variable) => domains[variable]!.size > 1)
      .sort((first, second) =>
        domains[first]!.size - domains[second]!.size
        || related[second]!.length - related[first]!.length
        || first - second
      );
    if (unresolved.length === 0) {
      return true;
    }
    const variable = unresolved[0]!;
    const candidates = [...domains[variable]!].sort((first, second) =>
      supportScore(variable, first) - supportScore(variable, second)
      || first - second
    );
    for (const candidate of candidates) {
      const marker = trail.length;
      replaceDomain(variable, new Set([candidate]));
      if (
        propagate(related[variable]!)
        && searchComponent(component)
      ) {
        return true;
      }
      restore(marker);
    }
    return false;
  };

  for (const component of constraintComponents(domains.length, constraints)) {
    if (!searchComponent(component)) {
      return undefined;
    }
  }
  return domains.map((domain) => [...domain][0]!);
}

function setsEqual<T>(first: ReadonlySet<T>, second: ReadonlySet<T>): boolean {
  return first.size === second.size
    && [...first].every((value) => second.has(value));
}

function setsIntersect<T>(
  first: ReadonlySet<T> | undefined,
  second: ReadonlySet<T>
): boolean {
  return first !== undefined && [...first].some((value) => second.has(value));
}

function intersectionSize<T>(
  first: ReadonlySet<T> | undefined,
  second: ReadonlySet<T>
): number {
  if (!first) {
    return 0;
  }
  let count = 0;
  for (const value of first) {
    if (second.has(value)) {
      count += 1;
    }
  }
  return count;
}

function twoWayCandidates(): readonly Candidate[] {
  if (candidateCache) {
    return candidateCache;
  }
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const base of twoWay7ReferenceTemplates()) {
    properCubeRotations().forEach((matrix, rotationId) => {
      const template = rotateTwoWay7Template(base, matrix);
      const signature = templateSignature(template);
      if (seen.has(signature)) {
        return;
      }
      seen.add(signature);
      const topology = localBoundaryTopology(template);
      candidates.push({
        name: `${base.name}_r${rotationId}`,
        template,
        partitions: topology.partitions,
        boundaryEdges: topology.boundaryEdges
      });
    });
  }
  candidateCache = candidates;
  return candidateCache;
}

function localBoundaryTopology(template: TwoWay7ReferenceTemplate): {
  partitions: LocalPartition[];
  boundaryEdges: LocalBoundaryEdges[];
} {
  const incidence = new Map<string, Array<{ element: Element; face: number[] }>>();
  for (const element of template.elements) {
    for (const faceTemplate of H1_FACES) {
      const face = faceTemplate.map((localId) => element[localId - 1]!);
      const key = [...face].sort((a, b) => a - b).join(":");
      const owners = incidence.get(key) ?? [];
      owners.push({ element, face });
      incidence.set(key, owners);
    }
  }

  const partitions: LocalPartition[] = [];
  const boundaryEdges: LocalBoundaryEdges[] = [];
  for (const parentFace of H1_FACES) {
    const parentPoints = parentFace.map((localId) => CORNER_SIGNS[localId - 1]!);
    const axis = [0, 1, 2].find((candidate) =>
      parentPoints.every((point) => point[candidate] === parentPoints[0]![candidate])
    )!;
    const side = parentPoints[0]![axis];
    const childFaces: LocalChildFace[] = [];
    const edgeByKey = new Map<string, LocalEdge>();
    for (const owners of incidence.values()) {
      if (owners.length !== 1) {
        continue;
      }
      const owner = owners[0]!;
      const points = owner.face.map((nodeId) => template.nodes[nodeId]!);
      if (!points.every((point) => Math.abs(point[axis]! - side!) <= 1e-12)) {
        continue;
      }
      childFaces.push(points);
      for (let index = 0; index < 4; index += 1) {
        const edge = [points[index]!, points[(index + 1) % 4]!] as const;
        const key = [referencePointKey(edge[0]), referencePointKey(edge[1])].sort().join("|");
        edgeByKey.set(key, edge);
      }
    }
    partitions.push(childFaces);
    boundaryEdges.push([...edgeByKey.values()]);
  }
  return { partitions, boundaryEdges };
}

function globalPartition(element: Element, partition: LocalPartition): string {
  return partition
    .map((childFace) => childFace.map((point) => referenceEntity(element, point)).sort().join("|"))
    .sort()
    .join("||");
}

function referenceEntity(element: Element, reference: ReferencePoint3): string {
  const weightedNodes: string[] = [];
  CORNER_SIGNS.forEach((sign, corner) => {
    let weight = 1;
    for (let axis = 0; axis < 3; axis += 1) {
      weight *= (1 + sign[axis]! * reference[axis]!) / 2;
    }
    const numerator64 = Math.round(weight * 64);
    if (numerator64 === 0) {
      return;
    }
    const divisor = gcd(Math.abs(numerator64), 64);
    weightedNodes.push(
      `${element[corner]!}:${numerator64 / divisor}/${64 / divisor}`
    );
  });
  return weightedNodes.sort().join(",");
}

function referencePhaseSignature(
  edges: LocalBoundaryEdges,
  outerFace: number
): number[] {
  const facePoints = H1_FACES[outerFace]!.map((localId) => CORNER_SIGNS[localId - 1]!);
  const axis = [0, 1, 2].find((candidate) =>
    facePoints.every((point) => point[candidate] === facePoints[0]![candidate])
  )!;
  const outerSide = facePoints[0]![axis]!;
  const levels: number[] = [];
  for (const [first, second] of edges) {
    if (first[axis] === second[axis]) {
      continue;
    }
    const changesAcrossFace = [0, 1, 2].some((cross) =>
      cross !== axis && first[cross] !== second[cross]
    );
    if (!changesAcrossFace) {
      continue;
    }
    const midpoint = (first[axis]! + second[axis]!) / 2;
    const phase = outerSide === -1 ? (midpoint + 1) / 2 : (1 - midpoint) / 2;
    levels.push(round(phase, 8));
  }
  return levels.sort((a, b) => a - b);
}

function buildFaceIncidence(mesh: Mesh): Map<string, FaceOwner[]> {
  const incidence = new Map<string, FaceOwner[]>();
  mesh.elements.forEach((element, index) => {
    const elementId = index + 1;
    H1_FACES.forEach((faceTemplate, face) => {
      const key = boundaryKey(faceTemplate.map((localId) => element[localId - 1]!));
      const owners = incidence.get(key) ?? [];
      owners.push({ elementId, face });
      incidence.set(key, owners);
    });
  });
  return incidence;
}

function constraintComponents(
  variableCount: number,
  constraints: readonly InterfaceConstraint[]
): number[][] {
  const adjacency = Array.from({ length: variableCount }, () => new Set<number>());
  for (const constraint of constraints) {
    adjacency[constraint.first]!.add(constraint.second);
    adjacency[constraint.second]!.add(constraint.first);
  }
  const remaining = new Set(Array.from({ length: variableCount }, (_, index) => index));
  const components: number[][] = [];
  while (remaining.size > 0) {
    const root = Math.min(...remaining);
    const queue = [root];
    const component: number[] = [];
    remaining.delete(root);
    while (queue.length > 0) {
      const variable = queue.shift()!;
      component.push(variable);
      for (const neighbor of adjacency[variable]!) {
        if (remaining.delete(neighbor)) {
          queue.push(neighbor);
        }
      }
    }
    components.push(component.sort((a, b) => a - b));
  }
  return components;
}

function templateSignature(template: TwoWay7ReferenceTemplate): string {
  return template.elements
    .map((element) =>
      element.map((nodeId) => referencePointKey(template.nodes[nodeId]!)).sort().join("|")
    )
    .sort()
    .join("||");
}

function localPartitionSignature(partition: LocalPartition): string {
  return partition
    .map((face) => face.map(referencePointKey).sort().join("|"))
    .sort()
    .join(";");
}

function referencePointKey(point: ReferencePoint3): string {
  return point.map((value) => Math.round(value * 2)).join(",");
}

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return Math.max(x, 1);
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}
