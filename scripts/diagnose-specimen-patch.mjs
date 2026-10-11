import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDirectTwoToOneHexPlan } from '../dist/two-to-one.js';
import { buildThreeToOneHexClassifiedReplacements } from '../dist/transitions.js';
import { auditHexRefinementQuality, auditHexRefinementPatchQuality } from '../dist/hex-quality.js';
import { inferHexElementLattice } from '../dist/regularization.js';
import { recoverHexLogicalFrames } from '../dist/hex-logical-frames-internal.js';
import { h1Permutations } from '../dist/topology.js';
import { twoWay7ReferenceTemplates, properCubeRotations, rotateTwoWay7Template, instantiateTwoWay7Template } from '../dist/two-to-one-templates.js';
import { probeSevenHexBoundary } from './seven-hex-boundary-probe.mjs';
import { replaceElements } from '../dist/mesh.js';
import { checkNoHangingNodes } from '../dist/conformance.js';

const folder = process.argv[2];
const ratio = Number(process.argv[3] ?? 2);
const mesh = JSON.parse(readFileSync(join(folder, 'mesh.json'), 'utf8'));
const region = JSON.parse(readFileSync(join(folder, 'region.json'), 'utf8'));
const roi = new Set(region.roi_element_ids);
if (process.argv.includes('--positive-x')) for (const id of roi) {
  if (mesh.elements[id - 1].reduce((sum, n) => sum + mesh.nodes[n - 1][0], 0) < 0) roi.delete(id);
}
const roiNodes = new Set([...roi].flatMap(id => mesh.elements[id - 1]));
const ids = mesh.elements.flatMap((element, i) => element.some(n => roiNodes.has(n)) ? [i + 1] : []);
const nodes = [...new Set(ids.flatMap(id => mesh.elements[id - 1]))].sort((a, b) => a - b);
const nodeMap = new Map(nodes.map((n, i) => [n, i + 1]));
const patch = { kind: 'H1', nodes: nodes.map(n => mesh.nodes[n - 1]), elements: ids.map(id => mesh.elements[id - 1].map(n => nodeMap.get(n))) };
const rotationIndex = process.argv.indexOf('--orientation');
if (rotationIndex >= 0) patch.elements = patch.elements.map(e => h1Permutations(e)[Number(process.argv[rotationIndex + 1])]);
const core = new Set(region.core_1layer_element_ids);
const selected = ids.flatMap((id, i) => core.has(id) ? [i + 1] : []);
const start = performance.now();
const lattice = inferHexElementLattice(patch, 1e-8);
const frames = recoverHexLogicalFrames(patch);
console.log(JSON.stringify({ lattice: { dimensions: lattice.dimensions, warnings: lattice.warnings },
  frames: frames && { dimensions: frames.dimensions, warnings: frames.warnings } }));
if (process.argv.includes('--lattice-only')) {
  for (let axis = 0; axis < 3; axis++) {
    const rows = new Map();
    ids.forEach((id, i) => {
      const xyz = lattice.indicesByElementId.get(i + 1);
      const key = xyz.filter((_, a) => a !== axis).join(':');
      const row = rows.get(key) ?? { roi: [], core: [] };
      if (roi.has(id)) row.roi.push(xyz[axis]);
      if (core.has(id)) row.core.push(xyz[axis]);
      rows.set(key, row);
    });
    const histogram = {};
    for (const row of rows.values()) if (row.roi.length) {
      const key = JSON.stringify({roi: row.roi.sort((a,b)=>a-b),core: row.core.sort((a,b)=>a-b)});
      histogram[key] = (histogram[key] ?? 0) + 1;
    }
    console.log(axis, histogram);
  }
  process.exit(0);
}
let plan = ratio === 2 ? buildDirectTwoToOneHexPlan(patch, selected) : {
  strategy: 'three-to-one', replacements: buildThreeToOneHexClassifiedReplacements(patch, selected)
};
if(process.argv.includes('--boundary-probe')){
  console.log(JSON.stringify(probeSevenHexBoundary(patch,plan,ids),null,2));process.exit(0);
}
if(process.argv.includes('--raw-conformance')){
  const assembled=replaceElements(patch,plan.replacements,1e-9);
  const result=checkNoHangingNodes(assembled,1e-8);
  console.log(JSON.stringify({diagnosticOnly:true,accepted:false,conformanceOk:result.ok,
    hangingCount:result.hanging.length,firstHanging:result.hanging[0],
    quality:auditHexRefinementPatchQuality(patch,plan.replacements)}));
  process.exit(0);
}
if (process.argv.includes('--height-grid')) {
  if (plan.strategy !== 'seven-hex') throw new Error('height probe requires a seven-hex plan');
  const templates=twoWay7ReferenceTemplates(), rotations=properCubeRotations();
  for (const lower of [.25,.375,.5,.625,.75]) for (const upper of [.5,.625,.75,.875]) {
    if (upper <= lower + .05) continue;
    const replacements=plan.replacements.map(r=>{
      if (r.role === 'selected') return r;
      const [,name,rotation]=r.refinement.source.match(/^(two_way7_[a-h])_r(\d+)$/);
      const base=templates.find(t=>t.name===name);
      const adjusted={...base,nodes:base.nodes.map(([x,y,z])=>[x,y,z===0?2*lower-1:z===.5?2*upper-1:z])};
      const template=rotateTwoWay7Template(adjusted,rotations[Number(rotation)]);
      return {...r,refinement:instantiateTwoWay7Template(patch.elements[r.elementId-1].map(n=>patch.nodes[n-1]),template)};
    });
    const q=auditHexRefinementPatchQuality(patch,replacements);
    console.log(JSON.stringify({lower,upper,delta:q.childOrientedVolume-q.parentOrientedVolume,error:q.relativeVolumeError,sj:q.childMinimumOrientedScaledJacobian}));
  }
  process.exit(0);
}
if (process.argv.includes('--reference-map')) {
  if (!frames || ratio !== 3) throw new Error('reference-map probe requires recovered frames and ratio 3');
  const referenceMesh = { ...patch, nodes: frames.nodeCoordinates };
  const referencePlan = buildThreeToOneHexClassifiedReplacements(referenceMesh, selected);
  console.log(JSON.stringify({before: auditHexRefinementPatchQuality(patch, plan.replacements)}));
  plan = {strategy:'three-to-one-reference-map-probe', replacements:referencePlan.map(r=>{
    const parent=patch.elements[r.elementId-1], logical=parent.map(n=>frames.nodeCoordinates[n-1]);
    const axes=[1,3,4].map(i=>logical[i].map((v,a)=>v-logical[0][a]));
    return {...r,refinement:{...r.refinement,nodes:r.refinement.nodes.map(q=>{
      const [u,v,w]=axes.map(axis=>q.reduce((s,value,a)=>s+(value-logical[0][a])*axis[a],0));
      const weights=[(1-u)*(1-v)*(1-w),u*(1-v)*(1-w),u*v*(1-w),(1-u)*v*(1-w),(1-u)*(1-v)*w,u*(1-v)*w,u*v*w,(1-u)*v*w];
      return [0,1,2].map(a=>parent.reduce((s,n,i)=>s+patch.nodes[n-1][a]*weights[i],0));
    })}};
  })};
}
const items = plan.replacements.map(r => ({
  id: ids[r.elementId - 1], role: r.role, code: r.templateCode,
  ...auditHexRefinementQuality(patch.elements[r.elementId - 1].map(n => patch.nodes[n - 1]), r.refinement)
}));
const outside = items.filter(r => !roi.has(r.id));
console.log(JSON.stringify({ strategy: plan.strategy, elapsedMs: performance.now() - start,
  quality: auditHexRefinementPatchQuality(patch, plan.replacements),
  outside, worst: items.sort((a, b) => b.relativeVolumeError - a.relativeVolumeError).slice(0, process.argv.includes('--summary') ? 0 : 12)
}, null, 2));
