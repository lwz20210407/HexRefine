export type AffineDomainResult =
  | { kind: "unsupported"; reason: string; constraintIndex?: number }
  | { kind: "unsatisfiable"; constraintIndices: number[] }
  | { kind: "satisfiable"; solution: number[] };

interface Equation { mask: bigint; rhs: number; proof: bigint }
interface SparseEquation { bits: number[]; rhs: number; owner: number }

/** Recognize exact affine support tables before using GF(2) elimination. */
export function solveAffineTemplateDomains(
  domains: readonly (readonly number[])[],
  constraints: readonly { first: number; second: number }[],
  supports: readonly ReadonlyMap<number, ReadonlySet<number>>[]
): AffineDomainResult {
  const widths: number[] = [], offsets: number[] = [];
  let bitCount = 0;
  for (const domain of domains) {
    if (domain.length === 0) return { kind: "unsatisfiable", constraintIndices: [] };
    const width = Math.log2(domain.length);
    if (!Number.isInteger(width) || width > 4) return { kind: "unsupported", reason: "domain is not a supported power of two" };
    offsets.push(bitCount); widths.push(width); bitCount += width;
  }
  const sparse: SparseEquation[] = [];
  for (const [index, { first, second }] of constraints.entries()) {
    const a = domains[first]!, b = domains[second]!;
    const wa = widths[first]!, wb = widths[second]!, width = wa + wb;
    const relation: number[] = [];
    a.forEach((candidate, i) => b.forEach((other, j) => {
      if (supports[index]!.get(candidate)?.has(other)) relation.push(i | (j << wa));
    }));
    if (!relation.length) return { kind: "unsatisfiable", constraintIndices: [index] };
    if (!Number.isInteger(Math.log2(relation.length))) return { kind: "unsupported", reason: "support cardinality is not a power of two", constraintIndex: index };

    const origin = relation[0]!;
    const span = new Map<number, number>();
    for (const point of relation) {
      let value = point ^ origin;
      while (value) {
        const pivot = value & -value;
        const existing = span.get(pivot);
        if (existing === undefined) { span.set(pivot, value); break; }
        value ^= existing;
      }
    }
    // An affine hull alone is not enough: every point of it must be allowed.
    if (2 ** span.size !== relation.length) return { kind: "unsupported", reason: "support table is not its affine hull", constraintIndex: index };
    const orthogonal = new Map<number, number>();
    for (let normal = 1; normal < 2 ** width; normal += 1) {
      if ([...span.values()].some(v => paritySmall(normal & v))) continue;
      let reduced = normal;
      while (reduced) {
        const pivot = reduced & -reduced;
        const existing = orthogonal.get(pivot);
        if (existing === undefined) { orthogonal.set(pivot, reduced); break; }
        reduced ^= existing;
      }
      if (!reduced) continue;
      const bits = new Set<number>();
      for (let bit = 0; bit < width; bit += 1) {
        if (!(normal & (1 << bit))) continue;
        const global = bit < wa ? offsets[first]! + bit : offsets[second]! + bit - wa;
        // Self-constraints can name the same variable bit on both sides.
        if (!bits.delete(global)) bits.add(global);
      }
      sparse.push({ bits: [...bits], rhs: paritySmall(normal & origin), owner: index });
    }
  }

  if (sparse.every(row => row.bits.length <= 2)) {
    const solved = solveParityForest(bitCount, sparse);
    if (solved.kind === "unsatisfiable") return solved;
    const solution = domains.map((domain, i) => domain[Array.from({ length: widths[i]! }, (_, bit) =>
      solved.values[offsets[i]! + bit]! * (1 << bit)
    ).reduce((a, b) => a + b, 0)]!);
    return checkedWitness(solution, constraints, supports);
  }
  // General affine rows need elimination; do not build quadratic-size proofs on huge fields.
  if (bitCount > 4096 || sparse.length > 8192) return {
    kind: "unsupported", reason: "general affine system exceeds the dense elimination budget"
  };
  const equations: Equation[] = sparse.map((row, i) => ({
    mask: row.bits.reduce((mask, bit) => mask ^ (1n << BigInt(bit)), 0n),
    rhs: row.rhs, proof: 1n << BigInt(i)
  }));
  const equationOwners = sparse.map(row => row.owner);

  const basis = new Map<bigint, Equation>();
  for (const source of equations) {
    let { mask, rhs, proof } = source;
    while (mask) {
      const pivot = mask & -mask;
      const row = basis.get(pivot);
      if (!row) { basis.set(pivot, { mask, rhs, proof }); break; }
      mask ^= row.mask; rhs ^= row.rhs; proof ^= row.proof;
    }
    if (mask === 0n && rhs) return {
      kind: "unsatisfiable",
      constraintIndices: [...new Set(equationOwners.filter((_, i) =>
        (proof & (1n << BigInt(i))) !== 0n
      ))].sort((a, b) => a - b)
    };
  }
  let bits = 0n;
  const pivots = [...basis.keys()].sort((a, b) => a > b ? -1 : a < b ? 1 : 0);
  for (const pivot of pivots) {
    const row = basis.get(pivot)!;
    let value = row.mask & bits, parity = 0;
    while (value) { parity ^= 1; value &= value - 1n; }
    if (parity ^ row.rhs) bits |= pivot;
  }
  const solution = domains.map((domain, i) => domain[Number(
    (bits >> BigInt(offsets[i]!)) & ((1n << BigInt(widths[i]!)) - 1n)
  )]!);
  return checkedWitness(solution, constraints, supports);
}

function checkedWitness(
  solution: number[], constraints: readonly { first: number; second: number }[],
  supports: readonly ReadonlyMap<number, ReadonlySet<number>>[]
): AffineDomainResult {
  // Verify the original (not its linearized) tables before returning a witness.
  if (constraints.some(({ first, second }, i) =>
    !supports[i]!.get(solution[first]!)?.has(solution[second]!)
  )) throw new Error("affine template-domain witness violates an original support table");
  return { kind: "satisfiable", solution };
}

function solveParityForest(count: number, equations: readonly SparseEquation[]):
  | { kind: "satisfiable"; values: Uint8Array }
  | { kind: "unsatisfiable"; constraintIndices: number[] } {
  const zero = count;
  const parent = Int32Array.from({ length: count + 1 }, (_, i) => i);
  const rank = new Uint8Array(count + 1), parity = new Uint8Array(count + 1);
  const forest: Array<Array<{ node: number; owner: number }>> = Array.from({ length: count + 1 }, () => []);
  const find = (node: number): { root: number; parity: number } => {
    let root = node, value = 0;
    while (parent[root] !== root) { value ^= parity[root]!; root = parent[root]!; }
    let current = node, remaining = value;
    while (parent[current] !== current) {
      const next = parent[current]!, edge = parity[current]!;
      parent[current] = root; parity[current] = remaining;
      remaining ^= edge; current = next;
    }
    return { root, parity: value };
  };
  for (const row of equations) {
    const a = row.bits[0] ?? zero, b = row.bits[1] ?? zero;
    const first = find(a), second = find(b);
    const relation = first.parity ^ second.parity ^ row.rhs;
    if (first.root === second.root) {
      if (!relation) continue;
      const previous = new Int32Array(count + 1).fill(-1), owners = new Int32Array(count + 1);
      const queue = [a]; previous[a] = a;
      for (let i = 0; i < queue.length && previous[b]! < 0; i += 1) {
        const node = queue[i]!;
        for (const edge of forest[node]!) if (previous[edge.node]! < 0) {
          previous[edge.node] = node; owners[edge.node] = edge.owner; queue.push(edge.node);
        }
      }
      if (previous[b]! < 0) throw new Error("parity proof forest lost a connected path");
      const core = new Set([row.owner]);
      for (let node = b; node !== a; node = previous[node]!) core.add(owners[node]!);
      return { kind: "unsatisfiable", constraintIndices: [...core].sort((x, y) => x - y) };
    }
    let root = first.root, other = second.root;
    if (rank[root]! > rank[other]!) [root, other] = [other, root];
    parent[root] = other; parity[root] = relation;
    if (rank[root] === rank[other]) rank[other] = rank[other]! + 1;
    forest[a]!.push({ node: b, owner: row.owner }); forest[b]!.push({ node: a, owner: row.owner });
  }
  const origin = find(zero), values = new Uint8Array(count);
  for (let node = 0; node < count; node += 1) {
    const found = find(node);
    values[node] = found.parity ^ (found.root === origin.root ? origin.parity : 0);
  }
  return { kind: "satisfiable", values };
}

function paritySmall(value: number): number {
  let result = 0;
  while (value) { result ^= 1; value &= value - 1; }
  return result;
}
