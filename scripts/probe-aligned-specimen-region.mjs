import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { recoverHexLogicalFrames } from '../dist/hex-logical-frames-internal.js';
import { H1_FACES, boundaryKey } from '../dist/topology.js';

const [source, destination] = process.argv.slice(2);
if (!source || !destination || source === destination) throw new Error('usage: source-folder separate-candidate-folder');
const mesh = JSON.parse(readFileSync(join(source, 'mesh.json'), 'utf8'));
const region = JSON.parse(readFileSync(join(source, 'region.json'), 'utf8'));
const roi = new Set(region.roi_element_ids);
const incidence = new Map();
mesh.elements.forEach((e, i) => H1_FACES.forEach(f => {
  const key = boundaryKey(f.map(c => e[c - 1]));
  const owners = incidence.get(key) ?? []; owners.push(i + 1); incidence.set(key, owners);
}));
const adjacent = mesh.elements.map(() => []);
for (const owners of incidence.values()) if (owners.length === 2) {
  adjacent[owners[0] - 1].push(owners[1]); adjacent[owners[1] - 1].push(owners[0]);
}
const unseen = new Set(roi), completed = new Set(roi), components = [];
while (unseen.size) {
  const queue = [unseen.values().next().value]; unseen.delete(queue[0]);
  for (let i = 0; i < queue.length; i++) for (const n of adjacent[queue[i] - 1]) {
    if (unseen.delete(n)) queue.push(n);
  }
  const touched = new Set(queue.flatMap(id => mesh.elements[id - 1]));
  const ids = mesh.elements.flatMap((e, i) => e.some(n => touched.has(n)) ? [i + 1] : []);
  const nodes = [...new Set(ids.flatMap(id => mesh.elements[id - 1]))];
  const nm = new Map(nodes.map((n, i) => [n, i + 1]));
  const recovered = recoverHexLogicalFrames({nodes: nodes.map(n => mesh.nodes[n - 1]), elements: ids.map(id => mesh.elements[id - 1].map(n => nm.get(n)))});
  if (!recovered) throw new Error('candidate patch has no consistent logical frames');
  const local = new Map(ids.map((id, i) => [id, recovered.indicesByElementId.get(i + 1)]));
  const min = [0,1,2].map(a => Math.min(...queue.map(id => local.get(id)[a])));
  const max = [0,1,2].map(a => Math.max(...queue.map(id => local.get(id)[a])));
  const filled = ids.filter(id => local.get(id).every((v, a) => v >= min[a] && v <= max[a]));
  if (filled.length !== min.reduce((s, v, a) => s * (max[a] - v + 1), 1)) throw new Error('ROI bounding box contains missing source parents');
  filled.forEach(id => completed.add(id));
  components.push({originalParents:queue.length, completedParents:filled.length, min, max});
}
function erode(mask) {
  return new Set([...mask].filter(id => adjacent[id - 1].every(n => mask.has(n))));
}
const core1 = erode(completed), core2 = erode(core1);
const added = [...completed].filter(id => !roi.has(id));
const points = added.flatMap(id => mesh.elements[id - 1].map(n => mesh.nodes[n - 1]));
const audit = {experimental:true, originalROIParents:roi.size, completedROIParents:completed.size,
  addedParentIds:added, components, addedBounds:{min:[0,1,2].map(a=>Math.min(...points.map(p=>p[a]))),max:[0,1,2].map(a=>Math.max(...points.map(p=>p[a])))}};
mkdirSync(destination, {recursive:true});
for (const name of ['mesh.json', 'source_metadata.json', 'original_mesh.k']) copyFileSync(join(source,name),join(destination,name));
writeFileSync(join(destination, 'region.json'), JSON.stringify({...region,
  case: destination.split(/[\\/]/).pop(), rationale: region.rationale + ' EXPERIMENTAL: coordinate-cut corner stairs completed to the enclosing source-topology block; inspect added shoulder parents before acceptance.',
  roi_element_ids:[...completed].sort((a,b)=>a-b), core_1layer_element_ids:[...core1].sort((a,b)=>a-b), core_2layer_element_ids:[...core2].sort((a,b)=>a-b),
  roi_parent_count:completed.size, core_1layer_count:core1.size, core_2layer_count:core2.size, topology_completion:audit
},null,2));
writeFileSync(join(destination,'topology_completion.json'),JSON.stringify(audit,null,2));
console.log(JSON.stringify({...audit,addedParentIds:added.length,core1:core1.size,core2:core2.size}));
