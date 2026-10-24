import {planTransitionBand,planTransitionAngularSeams,generateAnnularTransitionBand,generateAxialTransitionTube,
  type TransitionAngularSeamOptions,type TransitionAngularSeamPlan,type SolidTransitionRegularRegions,type TransitionMeshRequest} from "../../src/index.js";

const angles:TransitionAngularSeamOptions={seamAnglesDegrees:[0,90,180,270],startAngleDegrees:0};
const p=planTransitionBand({fineSegments:144,ratios:[2,3],depth:6});
const alignment:TransitionAngularSeamPlan=planTransitionAngularSeams(p,angles);
const provisional:false=alignment.geometryChecked;
const unstitched:false=alignment.existingMeshStitched;
generateAnnularTransitionBand({innerRadius:10,outerRadius:20,fineSegments:144,ratios:[2,3],...angles});
generateAxialTransitionTube({innerRadius:10,outerRadius:12,length:6,radialLayers:2,fineSegments:144,ratios:[2,3],...angles});
// @ts-expect-error Cut angles are numeric, not parser-coerced text.
const invalid:TransitionAngularSeamOptions={seamAnglesDegrees:["90"]};
void [provisional,unstitched,invalid];
const regularRegions:SolidTransitionRegularRegions={fine:{width:2,layers:2},coarse:{width:4,layers:1}};
const request:TransitionMeshRequest={schemaVersion:1,kind:"transition-mesh",mode:"axial",parameters:{},regularRegions};
void request;
// @ts-expect-error Regular region layer count cannot be a boolean.
const invalidRegion:SolidTransitionRegularRegions={fine:{width:2,layers:true}};
void invalidRegion;
