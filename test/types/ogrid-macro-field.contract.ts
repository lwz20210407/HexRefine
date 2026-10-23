import {refineOgridMacroField,OgridMacroFieldError,type OgridMacroFieldOptions,type Mesh} from "../../src/index.js";
function contract(mesh:Mesh,options:OgridMacroFieldOptions){
  const result=refineOgridMacroField(mesh,options);
  const ids:number[]=result.sourceParentIds;
  return {ids,report:result.report,roles:result.roles};
}
// @ts-expect-error Only explicitly bounded target levels are supported.
const wrong:OgridMacroFieldOptions={axis:2,targets:[{elementId:1,level:4}]};
void contract;void wrong;void OgridMacroFieldError;
