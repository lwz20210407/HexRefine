import {refineOgridMacroField,OgridMacroFieldError,type OgridMacroFieldOptions,type Mesh} from "../../src/index.js";
function contract(mesh:Mesh,options:OgridMacroFieldOptions){
  const result=refineOgridMacroField(mesh,options);
  const ids:number[]=result.sourceParentIds;
  return {ids,report:result.report,roles:result.roles};
}
// @ts-expect-error Only explicitly bounded target levels are supported.
const wrong:OgridMacroFieldOptions={axis:2,targets:[{elementId:1,level:4}]};
const extended:OgridMacroFieldOptions={axis:1,targets:[{elementId:1,level:2}],axialStationSearch:"extended",diagnosticSearchBudget:32};
// @ts-expect-error Geometry searches are explicitly bounded families.
const wrongSearch:OgridMacroFieldOptions={axis:1,targets:[{elementId:1,level:2}],axialStationSearch:"unlimited"};
// @ts-expect-error Failure-only search budgets must be numeric.
const wrongDiagnostic:OgridMacroFieldOptions={axis:1,targets:[{elementId:1,level:2}],diagnosticSearchBudget:"32"};
void contract;void wrong;void extended;void wrongSearch;void wrongDiagnostic;void OgridMacroFieldError;
