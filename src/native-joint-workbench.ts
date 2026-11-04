import {parseNativeLsdynaMixedKeyword,type LsdynaMixedMesh} from "./lsdyna-mixed.js";
import type {Mesh} from "./types.js";

interface JointQuality {nodes:number;elements:number;minimumCornerScaledJacobian:number;minimumGaussJacobian:number;}
interface JointReport {
  quality:JointQuality;parts:Array<JointQuality&{name:string}>;limitations:string[];kReadback:{sha256:string};
  plan:{seeds:{axialPerPitch:number;axialPerPlate:number};headToPlateAxialGap:number|null;axialDimensionsChanged:boolean};
}
interface JointJob {id:string;state:"running"|"succeeded"|"failed"|"cancelled";error:string|null;files?:Record<string,string>;report?:JointReport;}
export interface NativeJointSnapshot {
  mesh:Mesh;model:LsdynaMixedMesh;request:{kind:string;parameters:Record<string,unknown>};
  plan:Record<string,unknown>;quality:JointQuality;
  summary:{nodes:number;solids:number;quads:number;beams:number;warnings:string[]};
}

const defaults:Record<string,number>={diameter:16,across_flats:24,head_height:10,plate_x:40,plate_y:40,
  pitch:2,thread_length:16,nut_height:13,shank_length:8,plate_thickness:4,plate_count:2,
  sector:4,core_rings:2,radial:3,nut_radial:4,plate_outer_radial:2,head_layers:5,
  axial_per_pitch:4,axial_per_plate:2,element_limit:200000};
const axial=new Set(["pitch","thread_length","nut_height","shank_length","plate_thickness","plate_count","axial_per_pitch","axial_per_plate"]);
type Field=readonly [string,string,number,number,string];
const groups:Array<[string,Field[]]>=[
  ["尺寸 · mm",[["diameter","螺纹公称直径",.001,10000,"any"],["pitch","螺距",.001,1000,"any"],
    ["thread_length","螺纹段长度",.001,100000,"any"],["shank_length","光杆长度",0,100000,"any"],
    ["across_flats","六角对边距",.001,10000,"any"],["head_height","头部高度",.001,10000,"any"],
    ["nut_height","螺母高度",.001,10000,"any"]]],
  ["板组",[["plate_count","板数量",0,64,"1"],["plate_thickness","单板厚度",.001,10000,"any"],
    ["plate_x","板宽 X",.001,100000,"any"],["plate_y","板宽 Y",.001,100000,"any"]]],
  ["网格",[["sector","每60°分段",4,32,"4"],["axial_per_pitch","每螺距轴向分段",2,256,"1"],
    ["axial_per_plate","单板轴向分段",1,256,"1"],["core_rings","核心径向层",1,16,"1"],
    ["radial","螺纹径向层",1,16,"1"],["nut_radial","螺母径向层",1,16,"1"],
    ["plate_outer_radial","板外围径向层",1,32,"1"],["head_layers","头部轴向层",1,64,"1"],
    ["element_limit","单元预算",1,200000,"1"]]]
];

export function mountNativeJointWorkbench(root:HTMLElement,options:{available:boolean;isBusy:()=>boolean;setBusy:(busy:boolean)=>void;show:(snapshot:NativeJointSnapshot)=>void}) {
  const style=document.createElement("style");
  style.textContent=`.nj-panel{padding:10px 0;border-top:1px solid var(--line)}.nj-panel button{width:100%;margin:4px 0}.nj-status{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}.nj-dialog{width:min(780px,calc(100vw - 24px));max-height:88vh;padding:0;border:1px solid var(--line);border-radius:6px;color:var(--text);background:var(--panel)}.nj-dialog::backdrop{background:rgba(0,0,0,.35)}.nj-dialog header,.nj-dialog footer{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:12px 16px;background:var(--panel);position:sticky;z-index:2}.nj-dialog header{top:0;border-bottom:1px solid var(--line)}.nj-dialog footer{bottom:0;border-top:1px solid var(--line)}.nj-dialog h2{margin:0;font-size:17px;flex:1}.nj-dialog button{width:auto}.nj-dialog fieldset{border:0;border-bottom:1px solid var(--line);margin:0;padding:14px 16px}.nj-dialog legend{font-size:13px;color:var(--muted)}.nj-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 12px}.nj-fields label{display:flex;flex-direction:column;min-width:0;font-size:13px;gap:5px}.nj-fields input,.nj-fields select{box-sizing:border-box;min-width:0;width:100%;height:34px;border:1px solid var(--line);border-radius:3px;background:var(--input-bg);color:var(--text);padding:5px;font-size:14px}.nj-message{padding:0 16px;color:var(--bad);white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.nj-quality{padding:10px 16px;font-size:13px;white-space:pre-wrap}.nj-downloads{display:flex;gap:10px;flex-wrap:wrap;font-size:13px;padding:8px 16px}.nj-downloads a{color:var(--accent)}.nj-dialog progress{width:120px;height:8px}.nj-dialog :disabled{opacity:.5}.nj-dialog [hidden]{display:none!important}@media(max-width:620px){.nj-fields{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:370px){.nj-fields{grid-template-columns:1fr}}`;
  document.head.append(style);root.classList.add("nj-panel");
  root.innerHTML=`<h2>螺栓连接</h2><button type="button" data-nj="open">装配参数</button><div class="nj-status" role="status"></div>`;
  const dialog=document.createElement("dialog");dialog.id="native-joint-dialog";dialog.className="nj-dialog";
  dialog.innerHTML=`<form><header><h2>HexRefine · 螺栓连接</h2><button type="button" data-nj="close" aria-label="关闭装配参数">关闭</button></header><div data-nj="fields"></div><p class="nj-message" role="alert"></p><div class="nj-quality"></div><div class="nj-downloads"></div><footer><button type="submit" data-nj="generate">生成</button><button type="button" data-nj="cancel" disabled>取消任务</button><button type="button" data-nj="reset">恢复默认</button><progress hidden aria-label="装配任务运行中"></progress></footer></form>`;
  document.body.append(dialog);
  const form=dialog.querySelector("form")!;const fieldRoot=dialog.querySelector<HTMLElement>('[data-nj="fields"]')!;
  const message=dialog.querySelector<HTMLElement>(".nj-message")!;const quality=dialog.querySelector<HTMLElement>(".nj-quality")!;
  const downloads=dialog.querySelector<HTMLElement>(".nj-downloads")!;const status=root.querySelector<HTMLElement>(".nj-status")!;
  const open=root.querySelector<HTMLButtonElement>('[data-nj="open"]')!;
  const generate=dialog.querySelector<HTMLButtonElement>('[data-nj="generate"]')!;
  const cancel=dialog.querySelector<HTMLButtonElement>('[data-nj="cancel"]')!;
  const reset=dialog.querySelector<HTMLButtonElement>('[data-nj="reset"]')!;
  const progress=dialog.querySelector<HTMLProgressElement>("progress")!;
  const inputs=new Map<string,HTMLInputElement>();let pending=false;let activeJob:string|null=null;let cancelRequested=false;
  for(const [title,fields] of groups){
    const fieldset=document.createElement("fieldset");const legend=document.createElement("legend");legend.textContent=title;
    const grid=document.createElement("div");grid.className="nj-fields";fieldset.append(legend,grid);fieldRoot.append(fieldset);
    for(const [key,label,min,max,step] of fields){
      const item=document.createElement("label");item.textContent=label;const input=document.createElement("input");
      input.type="number";input.name=key;input.required=true;input.min=String(min);input.max=String(max);input.step=step;input.value=String(defaults[key]);
      inputs.set(key,input);item.append(input);grid.append(item);
    }
  }
  const hand=document.createElement("select");hand.name="handedness";hand.innerHTML='<option value="right">右旋</option><option value="left">左旋</option>';
  const handLabel=document.createElement("label");handLabel.textContent="旋向";handLabel.append(hand);fieldRoot.querySelector(".nj-fields")!.append(handLabel);
  function busy(value:boolean){pending=value;options.setBusy(value);generate.disabled=value;reset.disabled=value;cancel.disabled=!value;progress.hidden=!value;
    for(const input of inputs.values())input.disabled=value;hand.disabled=value;
  }
  function invalidate(){downloads.replaceChildren();quality.textContent="";message.textContent="";if(!pending)status.textContent="参数已修改";}
  fieldRoot.addEventListener("input",invalidate);
  open.addEventListener("click",()=>dialog.showModal());
  dialog.querySelector('[data-nj="close"]')!.addEventListener("click",()=>dialog.close());
  reset.addEventListener("click",()=>{for(const [key,input] of inputs)input.value=String(defaults[key]);hand.value="right";invalidate();});
  async function json(url:string,init?:RequestInit){const response=await fetch(url,init);const data=await response.json();if(!response.ok)throw new Error(data.error??`HTTP ${response.status}`);return data;}
  cancel.addEventListener("click",async()=>{
    cancelRequested=true;cancel.disabled=true;status.textContent="正在取消";if(!activeJob)return;
    try{await json(`/api/native-joint/jobs/${activeJob}`,{method:"DELETE"});}catch(error){message.textContent=String(error);cancel.disabled=false;cancelRequested=false;}
  });
  form.addEventListener("submit",async event=>{
    event.preventDefault();if(pending||options.isBusy()||!form.reportValidity())return;
    const parameters:Record<string,unknown>={handedness:hand.value};const axis:Record<string,number>={};
    for(const [key,input] of inputs){const value=input.valueAsNumber;if(!Number.isFinite(value))return;(axial.has(key)?axis:parameters)[key]=value;}
    parameters.axial=axis;invalidate();cancelRequested=false;busy(true);status.textContent="生成与审计中";
    try{
      let job=await json('/api/native-joint/jobs',{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({schemaVersion:1,parameters})}) as JointJob;
      activeJob=job.id;
      if(cancelRequested)await json(`/api/native-joint/jobs/${activeJob}`,{method:"DELETE"});
      while(job.state==="running"){
        await new Promise(resolve=>setTimeout(resolve,350));job=await json(`/api/native-joint/jobs/${job.id}`) as JointJob;
      }
      if(job.state==="cancelled"){status.textContent="已取消";return;}
      if(job.state!=="succeeded"||!job.files||!job.report)throw new Error(job.error??'生成失败');
      const response=await fetch(job.files['model.k']!);if(!response.ok)throw new Error('无法读取已生成的 K');
      const bytes=await response.arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',bytes);
      const hash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
      if(hash!==job.report.kReadback.sha256)throw new Error('生成 K 的哈希与审计不一致');
      const text=new TextDecoder().decode(bytes);const model=parseNativeLsdynaMixedKeyword(text);const report=job.report;
      if(model.nodes.length!==report.quality.nodes||model.solids.length!==report.quality.elements)throw new Error('预览数量与审计不一致');
      const mesh:Mesh={kind:"H1",nodes:model.nodes.map(p=>[...p]),elements:model.solids.map(s=>[...s.nodes])};
      options.show({mesh,model,request:{kind:"native-joint",parameters},plan:{},quality:report.quality,
        summary:{nodes:model.nodes.length,solids:model.solids.length,quads:0,beams:0,warnings:report.limitations}});
      quality.textContent=`节点 ${report.quality.nodes} · 六面体 ${report.quality.elements}\n最小 SJ ${report.quality.minimumCornerScaledJacobian.toFixed(5)}\n有效轴向分段（每螺距 / 单板）：${report.plan.seeds.axialPerPitch} / ${report.plan.seeds.axialPerPlate}\n轴向尺寸变化：${report.plan.axialDimensionsChanged?"有":"无"}\n头板间隙：${report.plan.headToPlateAxialGap??"—"} mm\n几何来源：解析参数（非独立 CAD）\n`+report.parts.map((p,i)=>`PID ${i+1} · ${p.name} · ${p.elements}`).join("\n");
      for(const [name,label] of [['model.k','下载 K'],['merged.inp','共节点 INP'],['parts.inp','分件 INP'],['report.json','审计报告']] as const){
        const link=document.createElement("a");link.href=job.files[name]!;link.download=name;link.textContent=label;downloads.append(link);
      }
      status.textContent=`已生成 ${report.quality.elements} H8`;
    }catch(error){message.textContent=error instanceof Error?error.message:String(error);status.textContent="任务失败";}
    finally{activeJob=null;cancelRequested=false;busy(false);}
  });
  open.disabled=true;status.textContent="检查本机后端";
  if(!options.available){status.textContent="本机装配后端未启用";return;}
  void json('/api/native-joint/capabilities').then(()=>{open.disabled=false;status.textContent="本机后端可用";}).catch(()=>{status.textContent="本机装配后端不可用";});
}
