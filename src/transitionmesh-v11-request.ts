import {
  generateTransitionMeshRequest,
  normalizeTransitionMeshRequest,
  type TransitionMeshMode,
} from "./transition-mesh-request.js";
import type {SolidTransitionRegularRegions} from "./transition-solid-regions.js";

export const transitionMeshV11Modes = [
  "PLANAR", "PLANAR_ANNULAR", "PLANAR_QUAD_FOUR", "ANNULAR_RADIAL", "AXIAL_SURFACE",
] as const;
export type TransitionMeshV11Mode = typeof transitionMeshV11Modes[number];

export interface TransitionMeshV11Request {
  schemaVersion: 1;
  kind: "transitionmesh-v11";
  mode: TransitionMeshV11Mode;
  parameters: Record<string, unknown>;
  extrusion?: {height: number; layers: number};
  regularRegions?: SolidTransitionRegularRegions;
}

const examples: Record<TransitionMeshV11Mode, Omit<TransitionMeshV11Request, "schemaVersion" | "kind" | "mode">> = {
  PLANAR: {parameters: {length: 12, depth: 6, fineSegments: 48, ratios: [2, 2, 2]}},
  PLANAR_ANNULAR: {
    parameters: {innerRadius: 4, outerRadius: 7, fineSegments: 128, ratios: [2, 2, 2]},
  },
  PLANAR_QUAD_FOUR: {
    parameters: {innerSize: [8, 6], fineSegments: [54, 54], ratio: 3, stages: 3},
  },
  ANNULAR_RADIAL: {
    parameters: {innerRadius: 4, outerRadius: 11, fineSegments: 128,
      ratios: [2, 2, 2], stageDepths: [1, 2, 4]},
    extrusion: {height: 12, layers: 2},
  },
  AXIAL_SURFACE: {
    parameters: {innerRadius: 4, outerRadius: 7, length: 6, radialLayers: 2,
      fineSegments: 64, ratios: [2, 2, 2], stageDepths: [1, 2, 3], origin: [0, 0, 2]},
    regularRegions: {fine: {width: 2, layers: 3}, coarse: {width: 4, layers: 1}},
  },
};

function isMode(value: unknown): value is TransitionMeshV11Mode {
  return transitionMeshV11Modes.some(mode => mode === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function exampleTransitionMeshV11Request(mode: unknown): TransitionMeshV11Request {
  if (!isMode(mode)) throw new RangeError("unknown TransitionMesh V1.1 mode");
  return {schemaVersion: 1, kind: "transitionmesh-v11", mode, ...structuredClone(examples[mode])};
}

/** Route V1.1 vocabulary to HexRefine's native TS generators, not Abaqus or Python. */
export function generateTransitionMeshV11Request(input: unknown) {
  if (!isRecord(input) || input.kind !== "transitionmesh-v11" || input.schemaVersion !== 1
      || !isMode(input.mode) || !isRecord(input.parameters)) {
    throw new TypeError("expected schemaVersion=1, kind=transitionmesh-v11, a supported mode and parameters");
  }
  const {mode, parameters, extrusion} = input;
  if (mode === "ANNULAR_RADIAL" && extrusion === undefined)
    throw new RangeError("ANNULAR_RADIAL requires extrusion height and layers");
  if (mode === "PLANAR_ANNULAR" && extrusion !== undefined)
    throw new RangeError("use ANNULAR_RADIAL for a solid annular extrusion");
  const modes: Record<TransitionMeshV11Mode, TransitionMeshMode> = {
    PLANAR: "planar",
    PLANAR_ANNULAR: "annular",
    PLANAR_QUAD_FOUR: "rectangular-rings",
    ANNULAR_RADIAL: "annular",
    AXIAL_SURFACE: "axial",
  };
  const hybrid = mode === "PLANAR" && ("coarseSegments" in parameters || "blocks" in parameters);
  const nativeMode = hybrid ? "hybrid" : modes[mode];
  if (mode === "PLANAR_QUAD_FOUR" && "cornerTopology" in parameters)
    throw new RangeError("the V1.1 request selects corner topology from the ratio");
  const nativeParameters = mode === "PLANAR_QUAD_FOUR" && parameters.ratio === 3
    ? {...parameters, cornerTopology: "carry"}
    : parameters;
  const native = normalizeTransitionMeshRequest({
    ...input, kind: "transition-mesh", mode: nativeMode, parameters: nativeParameters,
  });
  const result = generateTransitionMeshRequest(native);
  const request = structuredClone(input);
  const report = JSON.parse(result.files["report.json"]!);
  result.files["request.json"] = JSON.stringify(request, null, 2);
  result.files["report.json"] = JSON.stringify({
    ...report, request, nativeRequest: native, adapter: "transitionmesh-v11",
  }, null, 2);
  return {...result, request};
}
