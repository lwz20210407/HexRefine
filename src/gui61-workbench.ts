import {defaultGui61Request,gui61Kinds,gui61Fields,gui61Value,updateGui61Value,type Gui61Generated,type Gui61Kind,type Gui61Request} from "./gui61-generators.js";

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
  document.head.append(style);
  root.classList.add("gui61-panel");
  root.innerHTML=`<h2>参数建模</h2><button type="button" data-action="open">GUI_tg 6.1 参数</button><div class="gui61-summary" role="status"></div><select data-action="view" aria-label="生成模型显示"><option value="solid">实体 / 面网格</option><option value="both">钢筋叠加</option><option value="bars">仅钢筋</option></select><button data-action="download" type="button">导出生成 K</button><button data-action="report" type="button">导出参数与报告</button><button data-action="convert" type="button">转入局部细化</button>`;
  const dialog=document.createElement("dialog");dialog.className="gui61-dialog";dialog.id="gui61-dialog";
  dialog.innerHTML=`<form><header class="gui61-header"><h2>HexRefine · 参数建模</h2><select class="gui61-kind" aria-label="算法选择"></select><button type="button" data-action="close" aria-label="关闭参数">关闭</button></header><div class="gui61-fields"></div><p class="gui61-error" role="alert"></p><div class="gui61-resolved"></div><footer class="gui61-footer"><label><input type="checkbox" data-action="enable-k" checked>导出K文件</label><button type="submit" data-action="generate">生成预览</button><button type="button" data-action="reset">恢复本算法默认值</button><button type="button" data-action="import">导入参数JSON</button><input type="file" accept=".json" hidden data-action="file"></footer></form>`;
  document.body.append(dialog);
  const repairButton=document.createElement("button"),repairInput=document.createElement("input");
  repairButton.type="button";repairButton.dataset.action="repair";repairButton.textContent="接口修复 JSON";
  repairButton.title="加载带网格、待修复父单元和容差的JSON请求；不直接读取完整求解K";
  repairInput.type="file";repairInput.accept=".json";repairInput.hidden=true;repairInput.dataset.action="repair-file";
  root.insertBefore(repairButton,root.querySelector(".gui61-summary"));root.append(repairInput);
  const select=dialog.querySelector<HTMLSelectElement>(".gui61-kind")!;
  for(const [value,label] of gui61Kinds){const option=document.createElement("option");option.value=value;option.textContent=label;select.append(option);}
  const drafts=new Map<Gui61Kind,Gui61Request>();
  let current=defaultGui61Request("rectangular-solid"),snapshot:Gui61Generated|null=null,pending=false;
  const output=root.querySelector<HTMLElement>(".gui61-summary")!,error=dialog.querySelector<HTMLElement>(".gui61-error")!,resolved=dialog.querySelector<HTMLElement>(".gui61-resolved")!;
  const exportEnabled=dialog.querySelector<HTMLInputElement>('[data-action="enable-k"]')!,view=root.querySelector<HTMLSelectElement>('[data-action="view"]')!;
  function sync(){
    (root.querySelector('[data-action="download"]') as HTMLButtonElement).disabled=pending||!snapshot||!exportEnabled.checked;
    (root.querySelector('[data-action="report"]') as HTMLButtonElement).disabled=pending||!snapshot;
    (root.querySelector('[data-action="convert"]') as HTMLButtonElement).disabled=pending||!snapshot||!!snapshot.model;
    repairButton.disabled=pending||!options.runRepair;
    view.disabled=!snapshot||snapshot.summary.beams===0;
  }
  function invalidate(){snapshot=null;output.textContent="参数已修改，待生成";sync();}
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
      else{input.type="number";input.step=/barCounts|coarseCounts|layers|elementLimit/.test(field.path)?"1":"any";input.required=true;input.value=String(field.disabled&&field.path.endsWith("angleDegrees")?0:value??"");}
      input.addEventListener(field.type==="number"?"input":"change",()=>{
        let value:unknown=input.value;
        if(field.type==="toggle")value=(input as HTMLInputElement).checked?field.on:field.off;
        else if(field.type==="number")value=(input as HTMLInputElement).valueAsNumber;
        else value=field.options!.find(([v])=>String(v)===input.value)![0];
        current=updateGui61Value(current,field.path,value);drafts.set(current.kind,current);invalidate();error.textContent="";
        if(field.type!=="number")renderFields();
      });
      if(field.type==="toggle")label.append(input,text);else label.append(text,input);container.append(label);
    }
  }
  function save(name:string,text:string){const url=URL.createObjectURL(new Blob([text],{type:"text/plain;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  root.querySelector('[data-action="open"]')!.addEventListener("click",()=>{if(!options.isBusy()){renderFields();dialog.showModal();}});
  dialog.querySelector('[data-action="close"]')!.addEventListener("click",()=>{if(!pending)dialog.close();});
  dialog.addEventListener("cancel",e=>{if(pending)e.preventDefault();});
  select.addEventListener("change",()=>{drafts.set(current.kind,current);current=structuredClone(drafts.get(select.value as Gui61Kind)??defaultGui61Request(select.value as Gui61Kind));invalidate();error.textContent="";resolved.textContent="";renderFields();});
  dialog.querySelector('[data-action="reset"]')!.addEventListener("click",()=>{current=defaultGui61Request(current.kind);drafts.set(current.kind,current);invalidate();renderFields();});
  const file=dialog.querySelector<HTMLInputElement>('[data-action="file"]')!;
  dialog.querySelector('[data-action="import"]')!.addEventListener("click",()=>file.click());
  file.addEventListener("change",async()=>{
    try{const f=file.files?.[0];if(!f)return;const data=JSON.parse(await f.text());const parsed=(data?.schemaVersion?data:data?.request) as Gui61Request;
      if(parsed.schemaVersion!==1||!gui61Kinds.some(([k])=>k===parsed.kind)||!parsed.parameters||typeof parsed.parameters!=="object"||Array.isArray(parsed.parameters)||Object.keys(parsed).some(k=>!["schemaVersion","kind","parameters"].includes(k)))throw new Error("参数文件格式无效");
      for(const field of gui61Fields(parsed))if(gui61Value(parsed,field.path)===undefined)throw new Error(`参数文件缺少 ${field.path}`);
      current=structuredClone(parsed);select.value=current.kind;drafts.set(current.kind,current);invalidate();
      if(typeof data?.ui?.exportK==="boolean")exportEnabled.checked=data.ui.exportK;
      renderFields();sync();error.textContent="";
    }catch(e){error.textContent=String(e);}finally{file.value="";}
  });
  exportEnabled.addEventListener("change",sync);
  view.addEventListener("change",()=>options.view(view.value));
  root.querySelector('[data-action="download"]')!.addEventListener("click",()=>{if(snapshot&&exportEnabled.checked)save(snapshot.request.kind+".k",snapshot.files["mesh.k"]!);});
  root.querySelector('[data-action="report"]')!.addEventListener("click",()=>{
    if(snapshot)save(snapshot.request.kind+"-bundle.json",JSON.stringify({request:snapshot.request,ui:{exportK:exportEnabled.checked},files:Object.fromEntries(Object.entries(snapshot.files).filter(([name])=>name!=="mesh.k"))},null,2));
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
      const result=await options.run(structuredClone(current));options.show(result);snapshot=result;
      output.textContent=`${gui61Kinds.find(([k])=>k===result.request.kind)![1]} · 节点 ${result.summary.nodes} · 实体 ${result.summary.solids} · 面 ${result.summary.quads} · 梁 ${result.summary.beams}`;
      resolved.textContent=JSON.stringify({plan:result.plan,quality:result.quality},null,2);
      view.value=result.summary.beams?"both":"solid";options.view(view.value);dialog.close();
    }catch(e){error.textContent=e instanceof Error?e.message:String(e);resolved.textContent="未生成新结果";output.textContent="生成失败，未导出";}
    finally{pending=false;dialog.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>("input,button,select").forEach(e=>e.disabled=false);renderFields();sync();}
  });
  sync();
  return {invalidate(){snapshot=null;output.textContent="";sync();},open(){renderFields();dialog.showModal();}};
}
