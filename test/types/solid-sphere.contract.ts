import {generateSolidSphereGradedMesh,type SolidSphereGradingSpec} from "../../src/index.js";
const spec:SolidSphereGradingSpec={radius:10,faceSegments:16,radialSegments:8,capSegments:8,capLayers:2};
generateSolidSphereGradedMesh(spec).plan.refinementRatio satisfies 2;
generateSolidSphereGradedMesh(spec).regions.core satisfies number[];
// @ts-expect-error spherical concentric rings are not implemented by this bounded cap entry
generateSolidSphereGradedMesh({...spec,rings:3});
// @ts-expect-error no3:1 claim in this entry
generateSolidSphereGradedMesh({...spec,refinementRatio:3});
