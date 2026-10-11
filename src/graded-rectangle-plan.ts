export type TransitionReduction = 2 | 3;
export type ModelFraction = "quarter" | "half" | "full";
export type Count3 = [number, number, number];

export interface RectangularGradingSpec {
  fullSize: readonly [number, number, number];
  refinedSize: readonly [number, number];
  fineSize: number;
  coarseSize: number;
  reductions: { x: TransitionReduction; y: TransitionReduction; z: TransitionReduction };
  thicknessTransition: boolean;
  transitionStages: 1 | 2;
  modelFraction: ModelFraction;
  angleDegrees?: number;
}

export interface GradingBlock {
  name: string;
  min: Count3;
  max: Count3;
  counts: Count3;
}

export interface GradingInterface {
  first: string;
  second: string;
  normalAxis: 0 | 1;
  tangentialAxes: [number, number];
  firstCounts: [number, number];
  secondCounts: [number, number];
  reductions: [number, number];
}

export interface RectangularGradingPlan {
  spec: RectangularGradingSpec;
  effectiveReductions: Count3;
  countMultiples: Count3;
  fineCounts: Count3;
  fineSpacing: Count3;
  outerCounts: [number, number];
  effectiveAngleDegrees: number;
  offset: number;
  intermediateOffset: number;
  blocks: GradingBlock[];
  interfaces: GradingInterface[];
  issues: Array<{ code: string; message: string; interface?: [string, string] }>;
  warnings: string[];
}

export function planRectangularGrading(input: RectangularGradingSpec): RectangularGradingPlan {
  const allowed=new Set(["fullSize","refinedSize","fineSize","coarseSize","reductions","thicknessTransition","transitionStages","modelFraction","angleDegrees"]);
  if(Object.keys(input).some(key=>!allowed.has(key)))throw new RangeError("unsupported rectangular grading option");
  if (!Array.isArray(input.fullSize) || input.fullSize.length !== 3
    || !Array.isArray(input.refinedSize) || input.refinedSize.length !== 2) {
    throw new RangeError("fullSize requires three lengths and refinedSize requires two full lengths");
  }
  for (const value of [...input.fullSize, ...input.refinedSize, input.fineSize, input.coarseSize]) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError("mesh lengths and target sizes must be finite and positive");
  }
  const ratios = [input.reductions?.x, input.reductions?.y, input.reductions?.z];
  if (ratios.some(r => r !== 2 && r !== 3)) throw new RangeError("each reduction must be 2 (4-to-2) or 3 (3-to-1)");
  if(Object.keys(input.reductions).some(key=>!["x","y","z"].includes(key)))throw new RangeError("unknown reduction direction");
  if (typeof input.thicknessTransition !== "boolean") throw new TypeError("thicknessTransition must be boolean");
  if (![1, 2].includes(input.transitionStages)) throw new RangeError("transitionStages must be one or two");
  if (!["quarter", "half", "full"].includes(input.modelFraction)) throw new RangeError("unknown modelFraction");
  const angle = input.angleDegrees ?? 0;
  if (!Number.isFinite(angle) || Math.abs(angle) >= 90) throw new RangeError("angleDegrees must lie strictly between -90 and 90");
  const spec: RectangularGradingSpec = { ...input,
    fullSize: [input.fullSize[0], input.fullSize[1], input.fullSize[2]],
    refinedSize: [input.refinedSize[0], input.refinedSize[1]], reductions: { ...input.reductions } };
  const [length, width, height] = spec.fullSize;
  const dx = spec.refinedSize[0] / 2, dy = spec.refinedSize[1] / 2;
  const ox = length / 2 - dx, oy = width / 2 - dy;
  if (ox <= spec.coarseSize || oy <= spec.coarseSize) throw new RangeError("each outer band must be wider than one coarse cell");
  const effectiveReductions: Count3 = [ratios[0]!, ratios[1]!, spec.thicknessTransition ? ratios[2]! : 1];
  // Resolve thickness-off before alignment; never inherit a previous GUI invocation's biii.
  const countMultiples = effectiveReductions.map(r => (r === 2 ? 4 : r) ** spec.transitionStages) as Count3;
  const fineCounts = [dx, dy, height].map((extent, axis) => {
    const count = Math.round(extent / spec.fineSize);
    if (count < 1) throw new RangeError("the refined region is too small for the requested target size");
    return alignedCount(count, countMultiples[axis]!);
  }) as Count3;
  const outerCounts: [number, number] = [exactCount(ox / spec.coarseSize), exactCount(oy / spec.coarseSize)];
  const [rx, ry, rz] = effectiveReductions;
  const [nx, ny, nz] = fineCounts;
  const [cx, by] = outerCounts;
  const blocks: GradingBlock[] = [];
  const interfaces: GradingInterface[] = [];
  const warnings: string[] = [];
  const issues: RectangularGradingPlan["issues"] = [];
  const effectiveAngleDegrees = spec.modelFraction === "quarter" ? 0 : angle;
  if (angle !== effectiveAngleDegrees) warnings.push("quarter model forces the angle to zero, following the rectangular GUI branch");
  const offset = height * Math.tan(effectiveAngleDegrees * Math.PI / 180);
  if (Math.abs(offset) / 2 >= ox) throw new RangeError("tilt collapses an outer X band");
  const add = (name: string, x0: number, x1: number, y0: number, y1: number, counts: Count3) => {
    if (x1 <= x0 || y1 <= y0 || counts.some(n => !Number.isSafeInteger(n) || n < 1)) {
      throw new RangeError(`${name} has a nonpositive extent or invalid integer counts`);
    }
    blocks.push({ name, min: [x0, y0, 0], max: [x1, y1, height], counts });
  };
  const connect = (first: string, second: string, normalAxis: 0 | 1) => {
    const a = blocks.find(b => b.name === first)!, b = blocks.find(b => b.name === second)!;
    const axes: [number, number] = [1 - normalAxis, 2];
    const ac = axes.map(axis => a.counts[axis]!) as [number, number];
    const bc = axes.map(axis => b.counts[axis]!) as [number, number];
    const reductions = ac.map((n, i) => Math.max(n, bc[i]!) / Math.min(n, bc[i]!)) as [number, number];
    interfaces.push({ first, second, normalAxis, tangentialAxes: axes, firstCounts: ac, secondCounts: bc, reductions });
    for (let i = 0; i < 2; i += 1) {
      if (![1, 2, 3].includes(reductions[i]!)) issues.push({ code: "UNSUPPORTED_INTERFACE_RATIO", message: `${first}/${second} has incompatible tangential counts`, interface: [first, second] });
      if (reductions[i] === 2 && Math.max(ac[i]!, bc[i]!) % 4 !== 0) issues.push({
        code: "FOUR_TO_TWO_PAIRING", message: `${first}/${second} does not satisfy the GUI/TG four-to-two count multiple`, interface: [first, second]
      });
    }
  };
  add("D", 0, dx, 0, dy, [nx, ny, nz]);
  let intermediateOffset = 0;
  if (spec.transitionStages === 1) {
    add("B", 0, dx, dy, width / 2, [nx / rx, by, nz / rz]);
    add("C", dx, length / 2, 0, dy, [cx, ny / ry, nz / rz]);
    add("A", dx, length / 2, dy, width / 2, [cx, by, nz / rz]);
    connect("D", "B", 1); connect("D", "C", 0); connect("B", "A", 0); connect("C", "A", 1);
  } else {
    const b1 = alignedCount(Math.round(.618 * by), ry), c1 = alignedCount(Math.round(.618 * cx), rx);
    if (b1 >= by || c1 >= cx) throw new RangeError("the second transition band has no remaining coarse cells");
    const xb = dx + c1 * spec.coarseSize, yb = dy + b1 * spec.coarseSize;
    add("B1", 0, dx, dy, yb, [nx / rx, b1, nz / rz]);
    add("B2", 0, dx, yb, width / 2, [nx / rx ** 2, by - b1, nz / rz ** 2]);
    add("C1", dx, xb, 0, dy, [c1, ny / ry, nz / rz]);
    add("C2", xb, length / 2, 0, dy, [cx - c1, ny / ry ** 2, nz / rz ** 2]);
    add("A1", dx, xb, dy, yb, [c1, b1, nz / rz]);
    add("A2", dx, xb, yb, width / 2, [c1 / rx, by - b1, nz / rz ** 2]);
    add("A3", xb, length / 2, dy, yb, [cx - c1, b1 / ry, nz / rz ** 2]);
    add("A4", xb, length / 2, yb, width / 2, [cx - c1, by - b1, nz / rz ** 2]);
    connect("D", "B1", 1); connect("B1", "B2", 1); connect("D", "C1", 0); connect("C1", "C2", 0);
    connect("B1", "A1", 0); connect("B2", "A2", 0); connect("C1", "A1", 1); connect("C2", "A3", 1);
    connect("A1", "A2", 1); connect("A1", "A3", 0); connect("A2", "A4", 0); connect("A3", "A4", 1);
    intermediateOffset = offset * c1 / cx;
    if (Math.abs(offset-intermediateOffset)/2>=xb-dx || Math.abs(intermediateOffset)/2>=length/2-xb) {
      throw new RangeError("tilt collapses a double-transition X band");
    }
  }
  return { spec, effectiveReductions, countMultiples, fineCounts,
    fineSpacing: [dx / nx, dy / ny, height / nz], outerCounts,
    effectiveAngleDegrees, offset, intermediateOffset, blocks, interfaces, issues, warnings };
}

function alignedCount(count: number, multiple: number): number {
  const result = Math.ceil(count / multiple) * multiple;
  if (!Number.isSafeInteger(result)) throw new RangeError("mesh counts exceed safe integer range");
  return result;
}

function exactCount(value: number): number {
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded) || Math.abs(value - rounded) > 1e-10 * Math.max(1, value)) {
    throw new RangeError("outer band dimensions must be divisible by coarseSize; no silent geometry resizing is performed");
  }
  return rounded;
}
