import {defaultTransitionMeshRequest,normalizeTransitionMeshRequest,suggestTransitionMeshCounts,transitionMeshModes,type TransitionMeshMode,type TransitionMeshRequest} from "./transition-mesh-request.js";
import {planTransitionBand,planHybridTransitionBand} from "./transition-bands.js";
import {planRectangularTransitionRings} from "./transition-rect-rings.js";
import type {Gui61Generated} from "./gui61-generators.js";

export function mountTransitionMeshWorkbench(root:HTMLElement,options:{
  isBusy:()=>boolean;run:(request:TransitionMeshRequest)=>Promise<Gui61Generated>;
  accept:(result:Gui61Generated,label:string)=>void;invalidate:()=>void;
}) {
  root.classList.add("gui61-panel");
  root.innerHTML='<h2>过渡带</h2><button type="button" data-action="open-transition">过渡带参数</button>';
  const dialog=document.createElement("dialog");dialog.className="gui61-dialog";dialog.id="transition-mesh-dialog";
  dialog.innerHTML='<form><header class="gui61-header"><h2>过渡网格</h2><select class="transition-mode" aria-label="过渡模式"></select><button type="button" data-action="close-transition">关闭</button></header><div class="gui61-fields transition-fields"></div><p class="gui61-error" role="alert"></p><div class="gui61-resolved" role="status"></div><footer class="gui61-footer"><button type="button" data-action="check-transition">检查计数</button><button type="submit" data-action="generate-transition">生成预览</button><button type="button" data-action="reset-transition">恢复本模式默认值</button><button type="button" data-action="import-transition">导入参数JSON</button><input type="file" accept=".json" data-action="transition-file" hidden></footer></form>';
  document.body.append(dialog);
  const trialButton=document.createElement("button"),applyButton=document.createElement("button");
  trialButton.type="button";trialButton.dataset.action="trial-transition";trialButton.textContent="试生成";
  applyButton.type="button";applyButton.dataset.action="apply-transition";applyButton.textContent="应用试生成网格";applyButton.disabled=true;
  dialog.querySelector(".gui61-footer")!.append(trialButton,applyButton);
  const suggestButton=document.createElement("button");suggestButton.type="button";suggestButton.dataset.action="suggest-transition";suggestButton.textContent="使用建议计数";
  suggestButton.title="按模板端口约束调整计数；指定块顺序会保留";dialog.querySelector(".gui61-footer")!.append(suggestButton);
  const select=dialog.querySelector<HTMLSelectElement>(".transition-mode")!,fields=dialog.querySelector<HTMLElement>(".transition-fields")!,
    error=dialog.querySelector<HTMLElement>(".gui61-error")!,resolved=dialog.querySelector<HTMLElement>(".gui61-resolved")!;
  for(const [value,label] of transitionMeshModes){const o=document.createElement("option");o.value=value;o.textContent=label;select.append(o);}
  let current=defaultTransitionMeshRequest("planar"),pending=false,trial:Gui61Generated|null=null;
  const drafts=new Map<TransitionMeshMode,TransitionMeshRequest>();
  function value(path:string):unknown {return path.split('.').reduce((v,k)=>(v as Record<string,unknown>)?.[k],current as unknown);}
  function changed(){trial=null;applyButton.disabled=true;drafts.set(current.mode,structuredClone(current));error.textContent="";resolved.textContent="";options.invalidate();}
  function set(path:string,v:unknown){
    const keys=path.split('.');let object=current as unknown as Record<string,unknown>;
    for(const k of keys.slice(0,-1))object=object[k] as Record<string,unknown>;
    object[keys.at(-1)!]=v;changed();
  }
  function render(){
    fields.replaceChildren();select.value=current.mode;
    const groups=new Map<string,HTMLElement>();
    const host=(name:string)=>{
      if(!groups.has(name)){const box=document.createElement("fieldset"),legend=document.createElement("legend"),body=document.createElement("div");legend.textContent=name;body.className="fields";box.append(legend,body);fields.append(box);groups.set(name,body);}return groups.get(name)!;
    };
    const wrap=(label:string,element:HTMLElement,group:string,toggle=false)=>{
      const l=document.createElement("label"),text=document.createElement("span");text.textContent=label;
      if(toggle){l.className="toggle";l.append(element,text);}else l.append(text,element);host(group).append(l);
    };
    const number=(path:string,label:string,group="几何与网格")=>{
      const input=document.createElement("input");input.type="number";input.step=/fineSegments|coarseSegments|radialLayers|extrusion.layers/.test(path)?"1":"any";
      input.required=true;input.value=String(value(path)??"");input.dataset.transitionField=path;input.setAttribute("aria-label",label);
      input.addEventListener("input",()=>set(path,input.valueAsNumber));wrap(label,input,group);
    };
    const choice=(path:string,label:string,choices:readonly (readonly [string|number,string])[],group="过渡",custom?:(v:string)=>void)=>{
      const input=document.createElement("select");input.dataset.transitionField=path;input.setAttribute("aria-label",label);
      for(const [v,l] of choices){const o=document.createElement("option");o.value=String(v);o.textContent=l;input.append(o);}
      input.value=String(value(path));input.addEventListener("change",()=>{if(custom)custom(input.value);else set(path,choices.find(([v])=>String(v)===input.value)![0]);render();});wrap(label,input,group);return input;
    };
    const toggle=(path:string,label:string,checked:boolean,callback:(v:boolean)=>void,group="过渡")=>{
      const input=document.createElement("input");input.type="checkbox";input.checked=checked;input.dataset.transitionField=path;input.setAttribute("aria-label",label);
      input.addEventListener("change",()=>{callback(input.checked);changed();render();});wrap(label,input,group,true);return input;
    };
    const p=current.parameters,kind=current.mode;
    if(kind==="planar"||kind==="hybrid"){number("parameters.length","沿带长度");number("parameters.depth","过渡带宽");}
    if(kind==="annular"||kind==="axial"){
      number("parameters.innerRadius","内半径");number("parameters.outerRadius","外半径");
      number("parameters.startAngleDegrees","起始角（度）");number("parameters.sweepAngleDegrees","圆弧范围（度）");
    }
    if(kind==="rectangular-rings"){
      number("parameters.innerSize.0","中心区X全长");number("parameters.innerSize.1","中心区Y全长");
      number("parameters.fineSegments.0","中心区X分段数");number("parameters.fineSegments.1","中心区Y分段数");
      choice("parameters.ratio","倍率",[[2,"4→2"],[3,"3→1"]]);
      choice("parameters.stages","过渡级数",Array.from({length:8},(_,i)=>[i+1,String(i+1)] as const));
      toggle("parameters.includeCore","填充中心细网格",p.includeCore===true,v=>{p.includeCore=v;});
      toggle("parameters.optimizeCorners","优化角部节点",p.optimizeCorners!==false,v=>{p.optimizeCorners=v;}).disabled=p.ratio===3;
    }else number("parameters.fineSegments","细端分段数");
    if(kind==="hybrid"){
      number("parameters.coarseSegments","粗端分段数");
      const order=choice("parameters.order","块顺序",[["grouped","分组"],["interleave","交错"],["explicit","指定顺序"]],"过渡",v=>{
        let failure="";
        if(v==="explicit"){
          try{const plan=planHybridTransitionBand(p as never);if(plan.blocks.length>200)throw new Error("显式块超过200，请使用CLI");p.blocks=plan.blocks;}
          catch(e){failure=String(e);}
        }else{p.order=v;delete p.blocks;}changed();
        if(failure)error.textContent=failure;
      });
      order.value=Array.isArray(p.blocks)?"explicit":String(p.order??"grouped");
      if(Array.isArray(p.blocks)){
        const list=p.blocks as string[];
        list.forEach((_,i)=>choice(`parameters.blocks.${i}`,`块 ${i+1}`,[["single3","3:1 单块"],["pair2","2:1 成对块"]],"指定块顺序"));
        const add=document.createElement("button");add.type="button";add.textContent="新增块";
        add.addEventListener("click",()=>{if(list.length<200){list.push("single3");changed();render();}});
        const remove=document.createElement("button");remove.type="button";remove.textContent="删除末块";remove.disabled=!list.length;
        remove.addEventListener("click",()=>{list.pop();changed();render();});host("指定块顺序").append(add,remove);
      }
    }
    if(kind==="planar"||kind==="annular"||kind==="axial"){
      const ratios=Array.isArray(p.ratios)?p.ratios as number[]:[];
      const stages=choice("stage-count","过渡级数",Array.from({length:8},(_,i)=>[i+1,String(i+1)] as const),"过渡",v=>{
        p.ratios=Array.from({length:Number(v)},(_,i)=>ratios[i]??2);delete p.stageDepths;changed();
      });stages.value=String(ratios.length);
      toggle("explicit-widths","指定各级带宽",Array.isArray(p.stageDepths),v=>{
        if(v){const depth=kind==="planar"?Number(p.depth):kind==="axial"?Number(p.length):Number(p.outerRadius)-Number(p.innerRadius);p.stageDepths=ratios.map(()=>depth/ratios.length);}else delete p.stageDepths;
      });
      ratios.forEach((_,i)=>{
        choice(`parameters.ratios.${i}`,`第${i+1}级倍率`,[[2,"4→2"],[3,"3→1"]],"分级参数");
        if(Array.isArray(p.stageDepths))number(`parameters.stageDepths.${i}`,`第${i+1}级带宽`,"分级参数");
      });
    }
    if(kind==="planar"||kind==="hybrid")choice("parameters.fineSide","细端位置",[["bottom","局部下侧"],["top","局部上侧"]]);
    if(kind==="annular")choice("parameters.fineSide","细端位置",[["inner","内圆"],["outer","外圆"]]);
    if(kind==="axial"){
      number("parameters.length","轴向长度");number("parameters.radialLayers","壁厚层数");choice("parameters.fineEnd","细端位置",[["start","轴向起点"],["end","轴向终点"]]);
      for(const [i,a] of ["X","Y","Z"].entries()){number(`parameters.axis.${i}`,`轴向向量 ${a}`,"坐标框架");number(`parameters.origin.${i}`,`轴起点 ${a}`,"坐标框架");}
    }else{
      const name=kind==="annular"?"center":"origin";
      for(const [i,a] of ["X","Y"].entries())number(`parameters.${name}.${i}`,`${a}向平移`,"坐标框架");
      if(kind!=="annular")number("parameters.rotationDegrees","平面旋转（度）","坐标框架");
      toggle("extrusion-enabled","生成实体六面体",!!current.extrusion,v=>{if(v)current.extrusion={height:2,layers:2};else delete current.extrusion;},"实体");
      if(current.extrusion){number("extrusion.height","挤出厚度","实体");number("extrusion.layers","厚度层数","实体");}
    }
  }
  function open(){if(!pending&&!options.isBusy()){render();dialog.showModal();}}
  root.querySelector('[data-action="open-transition"]')!.addEventListener("click",open);
  dialog.querySelector('[data-action="close-transition"]')!.addEventListener("click",()=>{if(!pending)dialog.close();});
  dialog.addEventListener("cancel",e=>{if(pending)e.preventDefault();});
  select.addEventListener("change",()=>{drafts.set(current.mode,structuredClone(current));current=structuredClone(drafts.get(select.value as TransitionMeshMode)??defaultTransitionMeshRequest(select.value as TransitionMeshMode));changed();render();});
  dialog.querySelector('[data-action="reset-transition"]')!.addEventListener("click",()=>{current=defaultTransitionMeshRequest(current.mode);changed();render();});
  dialog.querySelector('[data-action="check-transition"]')!.addEventListener("click",()=>{
    try{
      const p=current.parameters,plan=current.mode==="hybrid"?planHybridTransitionBand(p as never):current.mode==="rectangular-rings"?planRectangularTransitionRings(p as never)
        :planTransitionBand({fineSegments:p.fineSegments as number,ratios:p.ratios as (2|3)[],depth:current.mode==="planar"?p.depth as number:current.mode==="axial"?p.length as number:(p.outerRadius as number)-(p.innerRadius as number),...(p.stageDepths!==undefined?{stageDepths:p.stageDepths as number[]}:{})});
      error.textContent="";resolved.textContent=JSON.stringify({counts:plan.counts,stageCount:plan.stageCount,geometryChecked:false,
        ...("requiredMultiple" in plan?{requiredMultiple:plan.requiredMultiple}:{}),...("outerSize" in plan?{outerSize:plan.outerSize}:{}),...("blocks" in plan?{blocks:plan.blocks.length}:{})},null,2);
    }catch(e){error.textContent=e instanceof Error?e.message:String(e);resolved.textContent="";}
  });
  suggestButton.addEventListener("click",()=>{
    try{const result=suggestTransitionMeshCounts(current);if(result.changes.length){current=result.request;changed();render();}error.textContent="";resolved.textContent=JSON.stringify({changes:result.changes,geometryChecked:false},null,2);}
    catch(e){error.textContent=e instanceof Error?e.message:String(e);}
  });
  const file=dialog.querySelector<HTMLInputElement>('[data-action="transition-file"]')!;
  dialog.querySelector('[data-action="import-transition"]')!.addEventListener("click",()=>file.click());
  file.addEventListener("change",async()=>{
    try{
      const f=file.files?.[0];if(!f)return;if(f.size>25*1024*1024)throw new Error("参数文件超过25MiB，请使用CLI");
      const parsed=JSON.parse(await f.text()),request=normalizeTransitionMeshRequest(parsed.request??parsed),p=request.parameters;
      if(Array.isArray(p.blocks)&&p.blocks.length>200)throw new Error("显式块超过200，请使用CLI");
      const defaults=defaultTransitionMeshRequest(request.mode).parameters;
      const optional=new Set(["origin","center","axis","fineSide","fineEnd","startAngleDegrees","sweepAngleDegrees","rotationDegrees","order","includeCore","optimizeCorners"]);
      for(const key of Object.keys(defaults))if(p[key]===undefined){
        if(optional.has(key))p[key]=structuredClone(defaults[key]);else throw new Error(`参数文件缺少 ${key}`);
      }
      for(const [key,defaultValue] of Object.entries(defaults)){
        if(typeof defaultValue==="number"&&(typeof p[key]!=="number"||!Number.isFinite(p[key])))throw new Error(`参数 ${key} 必须是数字`);
        if(typeof defaultValue==="boolean"&&typeof p[key]!=="boolean")throw new Error(`参数 ${key} 必须是布尔值`);
        if(Array.isArray(defaultValue)&&(!Array.isArray(p[key])||(p[key] as unknown[]).some(v=>typeof v!=="number"||!Number.isFinite(v))))throw new Error(`参数 ${key} 必须是数字数组`);
      }
      for(const key of ["origin","center","axis","innerSize"]){if(p[key]!==undefined&&(!Array.isArray(p[key])||(p[key] as unknown[]).length!==(key==="axis"||key==="origin"&&request.mode==="axial"?3:2)))throw new Error(`参数 ${key} 维度错误`);}
      if(p.ratios!==undefined&&(!Array.isArray(p.ratios)||p.ratios.length<1||p.ratios.length>8||p.ratios.some(r=>r!==2&&r!==3)))throw new Error("倍率序列无效");
      if(p.stageDepths!==undefined&&(!Array.isArray(p.stageDepths)||!Array.isArray(p.ratios)||p.stageDepths.length!==p.ratios.length))throw new Error("分级带宽数量与倍率级数不一致");
      if(p.blocks!==undefined&&(!Array.isArray(p.blocks)||p.blocks.some(b=>b!=="single3"&&b!=="pair2")))throw new Error("混排块类型无效");
      if(request.mode==="rectangular-rings"&&(!Array.isArray(p.fineSegments)||p.fineSegments.length!==2))throw new Error("矩形细分数需要X/Y两个值");
      current=request;changed();render();
    }catch(e){error.textContent=e instanceof Error?e.message:String(e);}finally{file.value="";}
  });
  trialButton.addEventListener("click",async()=>{
    if(pending||options.isBusy()||!dialog.querySelector("form")!.reportValidity())return;
    pending=true;trial=null;applyButton.disabled=true;error.textContent="";resolved.textContent="试生成中…";
    dialog.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLButtonElement>("input,select,button").forEach(c=>c.disabled=true);
    try{trial=await options.run(structuredClone(current));resolved.textContent=JSON.stringify({trial:"PASS",summary:trial.summary,quality:trial.quality},null,2);}
    catch(e){error.textContent=e instanceof Error?e.message:String(e);resolved.textContent="试生成失败";}
    finally{pending=false;dialog.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLButtonElement>("input,select,button").forEach(c=>c.disabled=false);render();applyButton.disabled=!trial;}
  });
  applyButton.addEventListener("click",()=>{
    if(!trial||pending||options.isBusy())return;
    options.accept(trial,transitionMeshModes.find(([m])=>m===current.mode)![1]);trial=null;applyButton.disabled=true;dialog.close();
  });
  dialog.querySelector("form")!.addEventListener("submit",async e=>{
    e.preventDefault();if(pending||options.isBusy())return;pending=true;trial=null;applyButton.disabled=true;error.textContent="";resolved.textContent="生成中…";
    dialog.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLButtonElement>("input,select,button").forEach(c=>c.disabled=true);
    try{const result=await options.run(structuredClone(current));options.accept(result,transitionMeshModes.find(([m])=>m===current.mode)![1]);resolved.textContent=JSON.stringify({plan:result.plan,quality:result.quality},null,2);dialog.close();}
    catch(e){error.textContent=e instanceof Error?e.message:String(e);resolved.textContent="未生成新网格";}
    finally{pending=false;dialog.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLButtonElement>("input,select,button").forEach(c=>c.disabled=false);render();applyButton.disabled=!trial;}
  });
  return {open};
}
