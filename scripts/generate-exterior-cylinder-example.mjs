import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {generateMappedCircularCore,refineQ1To4Q1,mergeCoincidentNodes,checkNoHangingNodes,iterateLsdynaKeywordLines,parseMeshText,minimumHexCornerScaledJacobian,hexElementSignedVolume} from '../dist/index.js';

/** Fixed, independently generated example; not a general seed/geometry planner. */
async function main(){
  const [destination,...extra]=process.argv.slice(2);
  if(!destination||extra.length)throw new Error('Usage: node scripts/generate-exterior-cylinder-example.mjs NEW_OUTPUT_DIRECTORY');
  const out=path.resolve(destination);
  try{await fs.lstat(out);throw new Error('Output already exists; refusing to overwrite');}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!(await fs.stat(path.dirname(out))).isDirectory())throw new Error('Output parent must exist');
  const inner=15,outer=18,radius=20,arc=6,rows=2,layers=25,height=50;
  const section=structuredClone(generateMappedCircularCore({radius:inner,radiusSegments:arc,arcSegments:arc,modelFraction:'full'}).mesh);
  const coreQuads=section.elements.length,template=refineQ1To4Q1([[1,0],[0,0],[0,1],[1,1]]);
  const polar=(r,theta)=>[r*Math.cos(theta),r*Math.sin(theta),0];
  const add=points=>{
    const area=points.reduce((sum,a,i)=>{const b=points[(i+1)%4];return sum+a[0]*b[1]-a[1]*b[0];},0);
    if(area<0)points=[points[0],points[3],points[2],points[1]];
    const start=section.nodes.length;section.nodes.push(...points);section.elements.push([1,2,3,4].map(n=>n+start));
  };
  // Reverse the radial template map, then restore positive physical orientation.
  for(let j=0;j<arc*4;j++){
    const nodes=template.nodes.map(p=>polar(inner+(1-p[1])*(outer-inner),(j+p[0])*Math.PI/(2*arc)));
    for(const e of template.elements)add(e.map(n=>nodes[n-1]));
  }
  for(let i=0;i<rows;i++)for(let j=0;j<arc*12;j++){
    const lo=outer+i*(radius-outer)/rows,hi=outer+(i+1)*(radius-outer)/rows,a=j*Math.PI/(6*arc),b=(j+1)*Math.PI/(6*arc);
    add([polar(lo,a),polar(hi,a),polar(hi,b),polar(lo,b)]);
  }
  const q=mergeCoincidentNodes(section,1e-9);
  if(!checkNoHangingNodes(q,1e-8).ok)throw new Error('Section interface mismatch');
  const mesh={kind:'H1',nodes:[],elements:[]},stride=q.nodes.length;
  for(let k=0;k<=layers;k++)mesh.nodes.push(...q.nodes.map(p=>[p[0],p[1],height*k/layers]));
  for(let k=0;k<layers;k++)for(const e of q.elements)mesh.elements.push([...e.map(n=>n+k*stride),...e.map(n=>n+(k+1)*stride)]);
  if(!checkNoHangingNodes(mesh,1e-8).ok)throw new Error('Solid interface mismatch');
  let minimumSJ=Infinity,volume=0;
  for(const e of mesh.elements){const points=e.map(n=>mesh.nodes[n-1]);minimumSJ=Math.min(minimumSJ,minimumHexCornerScaledJacobian(points));volume+=hexElementSignedVolume(points);}
  if(minimumSJ<=.2||mesh.elements.length!==8700)throw new Error('Fixed example count/quality guard failed');
  const expectedVolume=.5*radius**2*arc*12*Math.sin(Math.PI/(6*arc))*height;
  if(Math.abs(volume/expectedVolume-1)>1e-8)throw new Error('Discrete volume guard failed');
  const keyword=[...iterateLsdynaKeywordLines(mesh,{partId:1,coordinateFormat:'compact'})].join('\n')+'\n';
  const back=parseMeshText(keyword,'mesh.k');
  if(JSON.stringify(back.elements)!==JSON.stringify(mesh.elements))throw new Error('K connectivity readback failed');
  let rounding=0;for(let i=0;i<back.nodes.length;i++)for(let a=0;a<3;a++)rounding=Math.max(rounding,Math.abs(back.nodes[i][a]-mesh.nodes[i][a]));
  if(rounding>1e-10)throw new Error('K coordinate readback failed');
  const report={schemaVersion:1,implementation:'native-fixed-exterior-cylinder-example',radius,height,coreRadius:inner,transitionOuterRadius:outer,
    coarseToFineAngularIntervalsPerQuadrant:[arc,3*arc],radialReduction:3,axialLayers:layers,axialSpacing:height/layers,axialGrading:false,
    coreSectionQuads:coreQuads,sectionQuads:q.elements.length,nodes:mesh.nodes.length,elements:mesh.elements.length,
    minimumCornerSJ:minimumSJ,discreteVolume:volume,relativeDiscreteVolumeError:Math.abs(volume/expectedVolume-1),
    relativeAnalyticCylinderVolumeError:Math.abs(volume/(Math.PI*radius**2*height)-1),
    readback:{maximumCoordinateError:rounding,connectivityExact:true,sha256:createHash('sha256').update(keyword).digest('hex')},
    keywordScope:'NODE + ELEMENT_SOLID, PID1; no solver cards or boundary conditions',
    limitation:'Fixed native substitute topology, not an exact course replay or general generator; no axial grading, no 2:1 variant, no CAD/GUI support.',engineeringAcceptanceVerified:false};
  const reportText=JSON.stringify(report,null,2),disk=await fs.statfs(path.dirname(out));
  if(disk.bavail*disk.bsize<Buffer.byteLength(keyword)+Buffer.byteLength(reportText)+1024**3)throw new Error('Insufficient disk including1GiB reserve');
  await fs.mkdir(out);await fs.writeFile(path.join(out,'mesh.k.partial'),keyword,{flag:'wx'});
  await fs.writeFile(path.join(out,'report.json'),reportText,{flag:'wx'});
  await fs.rename(path.join(out,'mesh.k.partial'),path.join(out,'mesh.k'));
  console.log(JSON.stringify({ok:true,output:out,elements:mesh.elements.length,minimumCornerSJ:minimumSJ}));
}
main().catch(error=>{console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;});
