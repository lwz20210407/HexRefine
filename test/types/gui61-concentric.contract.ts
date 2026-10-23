import {defaultGui61Request,planGui61Concentric,gui61ConcentricStreamRequest,
  resizeGui61ConcentricRings,GUI_CONCENTRIC_ELEMENT_LIMIT,
  type Gui61Request,type ConcentricTransitionRing} from "../../src/index.js";

const request:Gui61Request=defaultGui61Request("concentric-circular-solid");
planGui61Concentric(request).expectedElements satisfies number;
gui61ConcentricStreamRequest(request).schemaVersion satisfies 1;
gui61ConcentricStreamRequest(request).parameters.rings satisfies readonly ConcentricTransitionRing[];
resizeGui61ConcentricRings(request,1) satisfies Gui61Request;
GUI_CONCENTRIC_ELEMENT_LIMIT satisfies number;
// @ts-expect-error only appending/removing the final ring is defined
resizeGui61ConcentricRings(request,0);
