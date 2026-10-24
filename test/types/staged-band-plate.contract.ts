import {generateStagedBandPlate,planStagedBandPlate,type StagedBandPlateSpec} from '../../src/index.js';
const spec:StagedBandPlateSpec={fullSize:[12,30,12],coreWidth:6,coreRows:4,coarseSectionCounts:[2,2],outerRows:2,stages:[{axis:0,reduction:2,width:2},{axis:2,reduction:3,width:2}]};
const plan=planStagedBandPlate(spec),mesh=generateStagedBandPlate(spec).mesh;
// @ts-expect-error Bands are normal toY; transverse refinement axes areX/Z.
const axis:StagedBandPlateSpec={...spec,stages:[{axis:1,reduction:2,width:2}]};
// @ts-expect-error Ratios are2 or3, not template child counts.
const ratio:StagedBandPlateSpec={...spec,stages:[{axis:0,reduction:4,width:2}]};
void plan;void mesh;void axis;void ratio;
