import {planConcentricRingWidths,ConcentricWidthPlanningError,type ConcentricWidthPlanningRequest,type ConcentricWidthFailureCode} from "../../src/index.js";
const r:ConcentricWidthPlanningRequest={schemaVersion:1,parameters:{radius:16,height:8,coreRadius:4,radiusSegments:20,arcSegments:32,axialSegments:16,modelFraction:"quarter",
  rings:[{innerRadius:4.5,outerRadius:5.5},{innerRadius:8.5,outerRadius:10.5}]},
  criteria:{minimumCornerScaledJacobian:.2,maximumTransitionEdgeAspectRatio:6,minimumTransitionEdgeToCoreRatio:1}};
planConcentricRingWidths(r).resolvedRequest.schemaVersion satisfies 1;
planConcentricRingWidths(r).report.actualTransitionEdgeToCoreRatio satisfies number;
planConcentricRingWidths(r).report.actualRegularEdgeToCoreRatio satisfies number|null;
function diagnostic(e:ConcentricWidthPlanningError){e.code satisfies ConcentricWidthFailureCode;e.diagnostics.fullAudits satisfies number;}
void diagnostic;
// @ts-expect-error criteria are required; a positive-Jacobian-only search is not this interface
planConcentricRingWidths({schemaVersion:1,parameters:r.parameters});
