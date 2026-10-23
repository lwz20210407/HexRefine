import {defaultGui61Request,gui61Kinds,gui61Fields,gui61Value,updateGui61Value,type Gui61Generated,type Gui61Kind,type Gui61Request} from "./gui61-generators.js";
import {parseGui61ParameterFile,createGui61ParameterArchive,verifyGui61ParameterReplay,type Gui61ParameterImport} from "./gui61-archive.js";
import {planGui61Concentric,resizeGui61ConcentricRings,gui61ConcentricStreamRequest,GUI_CONCENTRIC_ELEMENT_LIMIT} from "./gui61-concentric.js";

export function mountGui61Workbench(root:HTMLElement,options:{
  run:(request:Gui61Request)=>Promise<Gui61Generated>;
  runRepair?:(request:unknown)=>Promise<Gui61Generated>;
  show:(result:Gui61Generated)=>void;
  view:(mode:string)=>void;
  convert:()=>void;
  isBusy:()=>boolean;
}){
  const style=document.createElement("style");
  style.textContent=`.gui61-panel{padding:10px 0;border-top:1px solid var(--line)}.gui61-panel button,.gui61-panel select{width:100%;margin:4px 0}.gui61-summary{font-size:12px;line-height:1.5;overflow-wrap:anywhere}.gui61-dialog{color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:6px;width:min(800px,calc(100vw - 24px));max-height:86vh;padding:0}.gui61-dialog::backdrop{background:rgba(0,0,0,.35)}.gui61-header,.gui61-footer{padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;background:var(--panel)}.gui61-header{position:sticky;top:0;z-index:2;border-bottom:1px solid var(--line)}.gui61-header h2{font-size:17px;margin:0;flex:1}.gui61-dialog button{width:auto}.gui61-kind{min-width:190px;flex:1}.gui61-fields{padding:0 16px}.gui61-fields fieldset{border:0;border-bottom:1px solid var(--line);margin:0;padding:14px 0}.gui61-fields legend{font-size:13px;color:var(--muted);padding-top:12px}.gui61-fields .fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.gui61-fields label{display:flex;flex-direction:column;gap:5px;font-size:13px;min-width:0}.gui61-fields input,.gui61-fields select{box-sizing:border-box;width:100%;min-width:0;background:var(--input-bg);color:var(--text);border:1px solid var(--line);border-radius:3px;padding:7px;font-size:14px}.gui61-fields .toggle{flex-direction:row;align-items:center;min-height:34px;flex-wrap:wrap}.gui61-fields .toggle input{width:17px;height:17px}.gui61-dialog :disabled{opacity:.5}.gui61-footer{position:sticky;bottom:0;z-index:2;border-top:1px solid var(--line)}.gui61-footer label{display:flex;gap:7px;align-items:center;font-size:13px}.gui61-error{padding:0 16px;color:var(--bad);white-space:pre-wrap;font-size:13px}.gui61-resolved{margin:8px 16px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--muted);font-size:12px;line-height:1.6}.gui61-dialog [hidden]{display:none!important}@media(max-width:650px){.gui61-fields .fields{grid-template-columns:repeat(2,minmax(0,1fr))}.gui61-header{position:static}}@media(max-width:380px){.gui61-fields .fields{grid-template-columns:1fr}}`;
  style.textContent+=`.gui61-fields input,.gui61-fields select{height:34px;min-height:34px;line-height:18px}.gui61-fields .toggle input{height:17px;min-height:17px;flex:0 0 17px;padding:0}.gui61-footer label{white-space:nowrap;min-width:100px}.gui61-footer label input{width:17px;height:17px;flex:0 0 17px;margin:0}.gui61-panel button:disabled{opacity:.5}`;
  style.textContent+=`.gui61-rings{display:flex;gap:8px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line)}.gui61-rings span{flex:1;font-size:13px}.gui61-rings button{width:32px;height:32px;padding:0;font-size:20px}.gui61-resolved[data-invalid="true"]{color:var(--bad)}`;
  document.head.append(style);
  root.classList.add("gui61-panel");
  root.innerHTML=`<h2>参数建模</h2><button type="button" data-action="open">GUI_tg 6.1 参数</button><div class="gui61-summary" role="status"></div><select data-action="view" aria-label="生成模型显示"><option value="solid">实体 / 面网格</option><option value="both">钢筋叠加</option><option value="bars">仅钢筋</option></select><button data-action="download" type="button">导出生成 K</button><button data-action="report" type="button">导出参数与报告</button><button data-action="convert" type="button">转入局部细化</button>`;
  const dialog=document.createElement("dialog");dialog.className="gui61-dialog";dialog.id="gui61-dialog";
  dialog.innerHTML=`<form><header class="gui61-header"><h2>HexRefine · 参数建模</h2><select class="gui61-kind" aria-label="算法选择"></select><button type="button" data-action="close" aria-label="关闭参数">关闭</button></header><div class="gui61-fields"></div><p class="gui61-error" role="alert"></p><div class="gui61-resolved"></div><footer class="gui61-footer"><label><input type="checkbox" data-action="enable-k" checked>导出K文件</label><button type="submit" data-action="generate">生成预览</button><button type="button" data-action="reset">恢复本算法默认值</button><button type="button" data-action="import">导入参数JSON</button><input type="file" accept=".json" hidden data-action="file"></footer></form>`;
  document.body.append(dialog);
  const ringTools=document.createElement("div");ringTools.className="gui61-rings";ringTools.hidden=true;
  ringTools.innerHTML=`<span></span><button type="button" data-action="remove-ring" aria-label="删除末环" title="删除末环">-</button><button type="button" data-action="add-ring" aria-label="新增过渡环" title="新增过渡环">+</button>`;
  dialog.querySelector("form")!.insertBefore(ringTools,dialog.querySelector(".gui61-fields"));
  const streamButton=document.createElement("button");streamButton.type="button";streamButton.dataset.action="stream-request";streamButton.textContent="导出流式参数";streamButton.hidden=true;
  dialog.querySelector(".gui61-footer")!.append(streamButton);
  const inpButton=document.createElement("button");inpButton.type="button";inpButton.dataset.action="download-inp";inpButton.textContent="导出生成 INP";
  root.insertBefore(inpButton,root.querySelector('[data-action="report"]'));
  const repairButton=document.createElement("button"),repairInput=document.createElement("input");
  repairButton.type="button";repairButton.dataset.action="repair";repairButton.textContent="接口修复 JSON";
  repairButton.title="加载带网格、待修复父单元和容差的JSON请求；不直接读取完整求解K";
  repairInput.type="file";repairInput.accept=".json";repairInput.hidden=true;repairInput.dataset.action="repair-file";
  root.insertBefore(repairButton,root.querySelector(".gui61-summary"));root.append(repairInput);
  const select=dialog.querySelector<HTMLSelectElement>(".gui61-kind")!;
  for(const [value,label] of gui61Kinds){const option=document.createElement("option");option.value=value;option.textContent=label;select.append(option);}
  const drafts=new Map<Gui61Kind,Gui61Request>();
  let current=defaultGui61Request("rectangular-solid"),snapshot:Gui61Generated|null=null,pending=false;
  let replay:Gui61ParameterImport|undefined;
  const output=root.querySelector<HTMLElement>(".gui61-summary")!,error=dialog.querySelector<HTMLElement>(".gui61-error")!,resolved=dialog.querySelector<HTMLElement>(".gui61-resolved")!;
  const exportEnabled=dialog.querySelector<HTMLInputElement>('[data-action="enable-k"]')!,view=root.querySelector<HTMLSelectElement>('[data-action="view"]')!;
  const canExportK=()=>snapshot?.request.kind==="transition-mesh"||exportEnabled.checked;
  function sync(){
    inpButton.disabled=pending||!snapshot?.files["mesh.inp"];
    (root.querySelector('[data-action="download"]') as HTMLButtonElement).disabled=pending||!snapshot||!canExportK();
    (root.querySelector('[data-action="report"]') as HTMLButtonElement).disabled=pending||!snapshot;
    (root.querySelector('[data-action="convert"]') as HTMLButtonElement).disabled=pending||!snapshot||!!snapshot.model;
    repairButton.disabled=pending||!options.runRepair;
    view.disabled=!snapshot||snapshot.summary.beams===0;
    streamButton.hidden=current.kind!=="concentric-circular-solid";streamButton.disabled=pending;
    ringTools.hidden=current.kind!=="concentric-circular-solid";
    const n=Array.isArray(current.parameters.rings)?current.parameters.rings.length:0;
    (ringTools.querySelector('[data-action="add-ring"]') as HTMLButtonElement).disabled=pending||n>=8;
    (ringTools.querySelector('[data-action="remove-ring"]') as HTMLButtonElement).disabled=pending||n<=1;
  }
  function invalidate(){snapshot=null;replay=undefined;output.textContent="参数已修改，待生成";resolved.textContent="";resolved.dataset.invalid="false";sync();}
  function showConcentricPlan(){
    if(current.kind!=="concentric-circular-solid")return;
    try{
      const p=planGui61Concentric(current);resolved.dataset.invalid=String(p.expectedElements>GUI_CONCENTRIC_ELEMENT_LIMIT);
      resolved.textContent=`预计实体 ${p.expectedElements} · 核心 ${p.expectedCoreElements} · 周期 ${p.periodFineLayers} 层\n环向 ${p.angularCountsPerQuarter.join(" → ")}\n厚度间距 ${p.axialSpacings.join(" → ")}\n浏览器上限 ${GUI_CONCENTRIC_ELEMENT_LIMIT}`;
    }catch(e){resolved.dataset.invalid="true";resolved.textContent=e instanceof Error?e.message:String(e);}
  }
  function renderFields(){
    const host=dialog.querySelector(".gui61-fields")!;host.replaceChildren();
    const groups=new Map<string,HTMLElement>();
    for(const field of gui61Fields(current)){
      let container=groups.get(field.group);
      if(!container){const set=document.createElement("fieldset"),legend=document.createElement("legend");legend.textContent=field.group;container=document.createElement("div");container.className="fields";set.append(legend,container);host.append(set);groups.set(field.group,container);}
      const label=document.createElement("label"),text=document.createElement("span");text.textContent=field.label;
      const input=field.type==="choice"?document.createElement("select"):document.createElement("input");
      input.dataset.gui61Field=field.path;input.setAttribute("aria-label",field.label);input.disabled=!!field.disabled;
      const value=gui61Value(current,field.path);
      if(input instanceof HTMLSelectElement){
        for(const [v,title] of field.options!){const option=document.createElement("option");option.value=String(v);option.textContent=title;input.append(option);}input.value=String(value);
      }else if(field.type==="toggle"){input.type="checkbox";input.checked=value===field.on;label.className="toggle";}
      else{input.type="number";input.step=/barCounts|coarseCounts|layers|[eE]lementLimit|Segments/.test(field.path)?"1":"any";input.required=!field.optional;input.value=String(field.disabled&&field.path.endsWith("angleDegrees")?0:value??"");}
      input.addEventListener(field.type==="number"?"input":"change",()=>{
        let value:unknown=input.value;
        if(field.type==="toggle")value=(input as HTMLInputElement).checked?field.on:field.off;
        else if(field.type==="number")value=field.optional&&input.value===""?undefined:(input as HTMLInputElement).valueAsNumber;
        else value=field.options!.find(([v])=>String(v)===input.value)![0];
        current=updateGui61Value(current,field.path,value);drafts.set(current.kind,current);invalidate();error.textContent="";
        if(field.type!=="number")renderFields();else showConcentricPlan();
      });
      if(field.type==="toggle")label.append(input,text);else label.append(text,input);container.append(label);
    }
    if(current.kind==="concentric-circular-solid")ringTools.querySelector("span")!.textContent=`过渡环 ${Array.isArray(current.parameters.rings)?current.parameters.rings.length:0}`;
    sync();showConcentricPlan();
  }
  function save(name:string,text:string){const url=URL.createObjectURL(new Blob([text],{type:"text/plain;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  streamButton.addEventListener("click",()=>{
    try{save("concentric-stream-request.json",JSON.stringify(gui61ConcentricStreamRequest(current),null,2));error.textContent="";}
    catch(e){error.textContent=e instanceof Error?e.message:String(e);}
  });
  for(const [action,delta] of [["add-ring",1],["remove-ring",-1]] as const)ringTools.querySelector(`[data-action="${action}"]`)!.addEventListener("click",()=>{
    try{current=resizeGui61ConcentricRings(current,delta);drafts.set(current.kind,current);invalidate();error.textContent="";renderFields();}
    catch(e){error.textContent=e instanceof Error?e.message:String(e);}
  });
  root.querySelector('[data-action="open"]')!.addEventListener("click",()=>{if(!options.isBusy()){renderFields();dialog.showModal();}});
  dialog.querySelector('[data-action="close"]')!.addEventListener("click",()=>{if(!pending)dialog.close();});
  dialog.addEventListener("cancel",e=>{if(pending)e.preventDefault();});
  select.addEventListener("change",()=>{drafts.set(current.kind,current);current=structuredClone(drafts.get(select.value as Gui61Kind)??defaultGui61Request(select.value as Gui61Kind));invalidate();error.textContent="";resolved.textContent="";renderFields();});
  dialog.querySelector('[data-action="reset"]')!.addEventListener("click",()=>{current=defaultGui61Request(current.kind);drafts.set(current.kind,current);invalidate();renderFields();});
  const file=dialog.querySelector<HTMLInputElement>('[data-action="file"]')!;
  dialog.querySelector('[data-action="import"]')!.addEventListener("click",()=>file.click());
  file.addEventListener("change",async()=>{
    try{const f=file.files?.[0];if(!f)return;
      if(f.size>25*1024*1024)throw new Error("参数文件超过GUI的25MiB限额，请使用Node接口");
      const parsed=parseGui61ParameterFile(JSON.parse(await f.text()));
      current=parsed.request;select.value=current.kind;drafts.set(current.kind,current);invalidate();replay=parsed;
      if(parsed.exportK!==undefined)exportEnabled.checked=parsed.exportK;
      renderFields();sync();error.textContent="";
    }catch(e){error.textContent=String(e);}finally{file.value="";}
  });
  exportEnabled.addEventListener("change",sync);
  view.addEventListener("change",()=>options.view(view.value));
  root.querySelector('[data-action="download"]')!.addEventListener("click",()=>{if(snapshot&&canExportK())save(snapshot.request.kind+".k",snapshot.files["mesh.k"]!);});
  inpButton.addEventListener("click",()=>{if(snapshot?.files["mesh.inp"])save(snapshot.request.kind+".inp",snapshot.files["mesh.inp"]);});
  root.querySelector('[data-action="report"]')!.addEventListener("click",()=>{
    if(snapshot)save(snapshot.request.kind+"-bundle.json",JSON.stringify(gui61Kinds.some(([kind])=>kind===snapshot!.request.kind)?createGui61ParameterArchive(snapshot,canExportK()):{request:snapshot.request,ui:{exportK:canExportK()},files:Object.fromEntries(Object.entries(snapshot.files).filter(([name])=>name!=="mesh.k"))},null,2));
  });
  root.querySelector('[data-action="convert"]')!.addEventListener("click",()=>{if(snapshot&&!snapshot.model){options.convert();snapshot=null;output.textContent="已转入局部细化";sync();}});
  repairButton.addEventListener("click",()=>{if(!pending&&!options.isBusy())repairInput.click();});
  repairInput.addEventListener("change",async()=>{
    if(pending||options.isBusy()||!options.runRepair)return;
    const file=repairInput.files?.[0];if(!file)return;
    pending=true;snapshot=null;sync();output.textContent="正在检查接口修复请求…";
    try{
      if(file.size>25*1024*1024)throw new Error("修复请求超过GUI的25MiB限额，请使用Node CLI");
      const data=JSON.parse(await file.text());
      const result=await options.runRepair(data?.request??data);
      options.show(result);snapshot=result;view.value="solid";options.view("solid");
      output.textContent=`接口修复完成 · 节点 ${result.summary.nodes} · 实体 ${result.summary.solids}`;
    }catch(e){output.textContent=`接口修复失败，未导出：${e instanceof Error?e.message:String(e)}`;}
    finally{pending=false;repairInput.value="";sync();}
  });
  dialog.querySelector("form")!.addEventListener("submit",async e=>{
    e.preventDefault();if(pending||options.isBusy())return;
    pending=true;snapshot=null;sync();error.textContent="";resolved.textContent="生成中…";
    dialog.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>("input,button,select").forEach(e=>e.disabled=true);
    try{
      const result=await options.run(structuredClone(current));if(replay)verifyGui61ParameterReplay(replay,result);options.show(result);snapshot=result;
      output.textContent=`${gui61Kinds.find(([k])=>k===result.request.kind)![1]} · 节点 ${result.summary.nodes} · 实体 ${result.summary.solids} · 面 ${result.summary.quads} · 梁 ${result.summary.beams}`;
      resolved.textContent=JSON.stringify({plan:result.plan,quality:result.quality},null,2);
      view.value=result.summary.beams?"both":"solid";options.view(view.value);dialog.close();
    }catch(e){error.textContent=e instanceof Error?e.message:String(e);resolved.textContent="未生成新结果";output.textContent="生成失败，未导出";}
    finally{pending=false;dialog.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>("input,button,select").forEach(e=>e.disabled=false);renderFields();sync();}
  });
  sync();
  return {invalidate(){snapshot=null;output.textContent="";sync();},open(){renderFields();dialog.showModal();},
    accept(result:Gui61Generated,label:string){
      options.show(result);snapshot=result;view.value=result.summary.beams?"both":"solid";options.view(view.value);
      output.textContent=`${label} · 节点 ${result.summary.nodes} · 实体 ${result.summary.solids} · 面 ${result.summary.quads}`;sync();
    }};
}
