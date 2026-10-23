import {planConcentricSeeds,planGui61ConcentricWidths,applyGui61ConcentricWidthPlan,
  type ConcentricSeedPlanningRequest,type ConcentricSeedPlanningResult,type Gui61Request,type ConcentricWidthCriteria} from "../../src/index.js";
function contract(request:ConcentricSeedPlanningRequest,draft:Gui61Request,criteria:ConcentricWidthCriteria){
  const result:ConcentricSeedPlanningResult=planConcentricSeeds(request);
  const audited:false=result.report.topologyAndQualityAudited;
  const proposal=planGui61ConcentricWidths(draft,criteria);
  const next:Gui61Request=applyGui61ConcentricWidthPlan(draft,proposal);
  return {audited,next,result};
}
void contract;
