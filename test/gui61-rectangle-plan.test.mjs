import test from 'node:test';
import assert from 'node:assert/strict';
import { planRectangularGrading } from '../dist/graded-rectangle-plan.js';
import { createHexUnitCubeMesh, refineByElementIdsWithReport, checkNoHangingNodes,
  meshToLsdynaKeyword, parseMeshText } from '../dist/index.js';

const base = { fullSize: [4000, 3000, 300], refinedSize: [2000, 1200], fineSize: 50, coarseSize: 100,
  reductions: { x: 3, y: 3, z: 3 }, thicknessTransition: true, transitionStages: 1, modelFraction: 'half' };
const counts = p => Object.fromEntries(p.blocks.map(b => [b.name, b.counts]));

// Observed by executing the recovered parameter callback and TrueGrid on 2026-10-11.
test('GUI61 oracle: independent reduction counts agree for the measured combinations', () => {
  for (const [ratios, expected] of [
    [[3,3,3], {D:[21,12,6],B:[7,9,2],C:[10,4,2],A:[10,9,2]}],
    [[2,3,3], {D:[20,12,6],B:[10,9,2],C:[10,4,2],A:[10,9,2]}],
    [[3,2,3], {D:[21,12,6],B:[7,9,2],C:[10,6,2],A:[10,9,2]}],
    [[2,2,2], {D:[20,12,8],B:[10,9,4],C:[10,6,4],A:[10,9,4]}],
  ]) {
    const plan = planRectangularGrading({...base, reductions: {x:ratios[0],y:ratios[1],z:ratios[2]}});
    assert.deepEqual(counts(plan), expected);
    assert.deepEqual(plan.issues, []);
  }
});

test('GUI61 oracle: thickness-off preserves layer count in every block', () => {
  const plan = planRectangularGrading({...base, thicknessTransition: false});
  assert.deepEqual(counts(plan), {D:[21,12,6],B:[7,9,6],C:[10,4,6],A:[10,9,6]});
  assert.deepEqual(plan.effectiveReductions, [3,3,1]);
  // Intentional improvement over the original GUI: no inherited biii alignment state.
  assert.equal(planRectangularGrading({...base, fullSize:[4000,3000,350], thicknessTransition:false}).fineCounts[2],7);
});

test('GUI61 oracle: double bands reproduce measured D/B1/B2/C1/C2/A1-A4 counts', () => {
  const plan = planRectangularGrading({...base, fullSize:[4000,4000,900],refinedSize:[1800,1800],transitionStages:2});
  assert.deepEqual(counts(plan), {D:[18,18,18],B1:[6,9,6],B2:[2,2,2],C1:[9,6,6],C2:[2,2,2],
    A1:[9,9,6],A2:[3,2,2],A3:[2,3,2],A4:[2,2,2]});
  assert.deepEqual(plan.countMultiples,[9,9,9]);
  assert.equal(plan.blocks.find(b=>b.name==='B1').max[1],1800);
});

test('GUI61 planning distinguishes divisibility by sixteen from cumulative reduction by four', () => {
  const plan = planRectangularGrading({...base,fullSize:[4000,4000,800],refinedSize:[1600,1600],
    reductions:{x:2,y:2,z:2},transitionStages:2});
  assert.deepEqual(plan.countMultiples,[16,16,16]);
  assert.equal(counts(plan).B2[0],counts(plan).D[0]/4);
  assert.equal(counts(plan).B2[2],counts(plan).D[2]/4);
});

test('GUI61 planning preserves input and distinguishes tilt parameters from geometry', () => {
  const input = structuredClone({...base,angleDegrees:10});
  const before = structuredClone(input);
  const plan = planRectangularGrading(input);
  assert.ok(Math.abs(plan.offset-300*Math.tan(Math.PI/18))<1e-10);
  assert.deepEqual(input,before);
  plan.spec.reductions.x=2;
  assert.equal(input.reductions.x,3);
  const quarter = planRectangularGrading({...input,modelFraction:'quarter'});
  assert.equal(quarter.offset,0);
  assert.equal(quarter.warnings.length,1);
});

test('GUI61 planning explicitly rejects fractional counts and collapsed second bands', () => {
  assert.throws(()=>planRectangularGrading({...base,coarseSize:110}),/divisible/);
  assert.throws(()=>planRectangularGrading({...base,fullSize:[2400,1600,300],transitionStages:2}),/second transition band/);
  assert.throws(()=>planRectangularGrading({...base,reductions:{x:4,y:3,z:3}}),/reduction/);
  assert.throws(()=>planRectangularGrading({...base,elementLimit:100}),/unsupported/);
});

test('GUI61 rectangular benchmark is generated conformingly without MATLAB or TrueGrid', () => {
  const x=[...Array.from({length:11},(_,i)=>-2000+100*i),
    ...Array.from({length:14},(_,i)=>-1000+2000*(i+1)/14),
    ...Array.from({length:10},(_,i)=>1000+100*(i+1))];
  const y=[...Array.from({length:5},(_,i)=>150*i),...Array.from({length:9},(_,i)=>600+100*(i+1))];
  const z=[0,150,300];
  const mesh=createHexUnitCubeMesh(x.length-1,y.length-1,z.length-1);
  mesh.nodes=mesh.nodes.map(([u,v,w])=>[x[Math.round(u*(x.length-1))],y[Math.round(v*(y.length-1))],z[Math.round(w*2)]]);
  const selected=mesh.elements.flatMap((e,i)=>{
    const center=e.reduce((s,n)=>s.map((v,a)=>v+mesh.nodes[n-1][a]/8),[0,0,0]);
    return Math.abs(center[0])<1000 && center[1]<600 ? [i+1]:[];
  });
  assert.equal(selected.length,112);
  const result=refineByElementIdsWithReport(mesh,selected,{hexRefinementRatio:3,regularizeHexSelection:false,
    includeTransitions:true,mergeTolerance:1e-7});
  assert.equal(result.mesh.nodes.length,5574);
  assert.equal(result.mesh.elements.length,4340);
  assert.equal(result.summary.unchangedElementCount,724);
  assert.equal(result.quality.ok,true);
  assert.ok(result.quality.childMinimumOrientedScaledJacobian>0.3);
  assert.ok(result.quality.relativeVolumeError<1e-12);
  assert.equal(checkNoHangingNodes(result.mesh,1e-6).ok,true);
  const readback=parseMeshText(meshToLsdynaKeyword(result.mesh),'generated.k');
  assert.deepEqual(readback.elements,result.mesh.elements);
  assert.equal(readback.nodes.length,result.mesh.nodes.length);
});
