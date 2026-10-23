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
