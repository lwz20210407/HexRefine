import {generateMappedCircularCore,generateMappedCircularPrism,planMappedCircularCore,
  type MappedCircularCoreSpec,type MappedCircularPrismSpec,type MappedCircularCoreResult} from "../../src/index.js";

const spec:MappedCircularCoreSpec={radius:24,radiusSegments:48,arcSegments:80,modelFraction:"quarter"};
const core:MappedCircularCoreResult=generateMappedCircularCore(spec);
planMappedCircularCore(spec).expectedElementCount satisfies number;
core.nodeSets.circular_boundary satisfies number[];
core.patchElementIds["x-wing"] satisfies number[];
const prism:MappedCircularPrismSpec={...spec,height:8,axialSegments:16};
generateMappedCircularPrism(prism).mesh satisfies typeof core.mesh;
// @ts-expect-error no claim of a ratio option on a uniform mapped-core primitive
generateMappedCircularCore({...spec,ratio:2});
// @ts-expect-error volume extrusion requires an explicit axial segment count
generateMappedCircularPrism({...spec,height:8});
// @ts-expect-error tilted quarter domains are not defined by this primitive
generateMappedCircularCore({...spec,angleDegrees:15});

import {planConcentricCircularMesh,prepareConcentricCircularMesh,iterateConcentricCircularElements,
  type ConcentricCircularSpec} from "../../src/index.js";
const coupled:ConcentricCircularSpec={radius:16,height:8,coreRadius:4,radiusSegments:20,arcSegments:32,
  axialSegments:16,modelFraction:"quarter",rings:[{innerRadius:4.5,outerRadius:5.5},{innerRadius:8.5,outerRadius:10.5}]};
planConcentricCircularMesh(coupled).expectedCoreElements satisfies number;
const periodic=prepareConcentricCircularMesh(coupled);
iterateConcentricCircularElements(periodic) satisfies Generator<number[]>;
// @ts-expect-error coupled generator currently has a fixed2:1 contract, not a selectable ratio
prepareConcentricCircularMesh({...coupled,ratio:3});
