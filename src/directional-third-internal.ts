import type { LocalRefinement, Mesh, ReplaceElement } from "./types.js";
import { h1Permutations } from "./topology.js";
import { refineHexTo4Hex, refineHexTo5Hex } from "./templates.js";
import { minElementEdgeLength, replaceElements } from "./mesh.js";
import { auditHexRefinementPatchQuality } from "./hex-quality.js";

const EDGES = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]] as const;
const key = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;

/** Internal pass for generated Cartesian cores; unsupported edge masks fail closed. */
export function directionalThirdPass(
  mesh: Mesh, lineage: readonly number[], coreParents: ReadonlySet<number>, axis: 0 | 1 | 2,
  tolerance: number
): { mesh: Mesh; lineage: number[] } {
  const marked = new Set<string>();
  const coreElements = new Set<number>();
  mesh.elements.forEach((element, index) => {
    if (!coreParents.has(lineage[index]!)) return;
    coreElements.add(index + 1);
    let count = 0;
    for (const [a, b] of EDGES) {
      const p = mesh.nodes[element[a]! - 1]!, q = mesh.nodes[element[b]! - 1]!;
      if ([0,1,2].every(d => d === axis || Math.abs(p[d]! - q[d]!) <= tolerance)
        && Math.abs(p[axis]! - q[axis]!) > tolerance) {
        marked.add(key(element[a]!, element[b]!));
        count += 1;
      }
    }
    if (count !== 4) throw new Error("directional thirds require an axis-aligned tensor core");
  });
  const replacements: ReplaceElement[] = [];
  mesh.elements.forEach((element, index) => {
    const edges = EDGES.filter(([a,b]) => marked.has(key(element[a]!, element[b]!)));
    if (edges.length === 0) return;
    const permutations = h1Permutations(element);
    let refinement: LocalRefinement;
    if (edges.length === 1) {
      const oriented = permutations.find(p => marked.has(key(p[0]!, p[4]!)))!;
      refinement = refineHexTo5Hex(oriented.map(n => mesh.nodes[n - 1]!));
    } else if (edges.length === 2) {
      const oriented = permutations.find(p => marked.has(key(p[0]!, p[3]!)) && marked.has(key(p[1]!, p[2]!)));
      if (!oriented) throw new Error(`unsupported opposite or mixed third-edge pair in cell ${index + 1}`);
      refinement = refineHexTo4Hex(oriented.map(n => mesh.nodes[n - 1]!));
    } else if (edges.length === 4) {
      const oriented = permutations.find(p => [[0,4],[1,5],[2,6],[3,7]].every(([a,b]) => marked.has(key(p[a!]!, p[b!]!))));
      if (!oriented) throw new Error(`unsupported mixed third-edge family in cell ${index + 1}`);
      const corners = oriented.map(n => mesh.nodes[n - 1]!);
      const nodes = Array.from({length:4}, (_,k) => corners.slice(0,4).map((p,i) =>
        p.map((v,d) => v + (corners[i+4]![d]! - v) * k / 3))).flat();
      refinement = {kind:"H1",source:"directional_three_slabs",nodes,
        elements:[0,1,2].map(k => [1,2,3,4,5,6,7,8].map(n => n + k * 4))};
    } else {
      throw new Error(`unsupported ${edges.length}-edge third mask in cell ${index + 1}`);
    }
    if (coreElements.has(index + 1) && refinement.elements.length !== 3) {
      throw new Error("a core cell must be split into exactly three slabs in one third pass");
    }
    replacements.push({elementId:index + 1,refinement});
  });
  const next = applyWithLineage(mesh, lineage, replacements, tolerance);
  if (minElementEdgeLength(next.mesh) <= tolerance * 100) throw new Error("third-pass nodes are too close for the merge tolerance");
  return next;
}

export function applyWithLineage(
  mesh: Mesh, lineage: readonly number[], replacements: readonly ReplaceElement[], tolerance: number
): { mesh: Mesh; lineage: number[] } {
  const quality = auditHexRefinementPatchQuality(mesh, replacements);
  if (!quality.ok) throw new Error("directional pass failed parent/child quality audit");
  const replaced = new Set(replacements.map(r => r.elementId));
  const nextLineage = lineage.filter((_,i) => !replaced.has(i + 1));
  for (const replacement of replacements) {
    nextLineage.push(...replacement.refinement.elements.map(() => lineage[replacement.elementId - 1]!));
  }
  const next = replaceElements(mesh, replacements, tolerance);
  if (next.elements.length !== nextLineage.length) throw new Error("directional refinement lost cell lineage");
  return {mesh:next,lineage:nextLineage};
}
