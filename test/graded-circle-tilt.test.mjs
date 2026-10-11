import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCircularGradedMesh,checkNoHangingNodes} from '../dist/index.js';
const base={radius:20,thickness:6,coreHalfSize:8,fineSize:1,coarseSize:2,reductions:{x:3,y:3},modelFraction:'half'};

for(const modelFraction of ['half','full'])for(const x of [2,3])for(const y of [2,3])for(const angleDegrees of [-15,15]){
  test(`tilted circular ${modelFraction} ${x}/${y}/3 ${angleDegrees} degrees`,()=>{
    const spec={...base,modelFraction,reductions:{x,y}};
    const zero=generateCircularGradedMesh(spec),r=generateCircularGradedMesh({...spec,angleDegrees});
    assert.deepEqual(r.mesh.elements,zero.mesh.elements);
    assert.deepEqual(r.parentElementIds,zero.parentElementIds);
    assert.ok(r.quality.minimumCornerScaledJacobian>0 && r.quality.minimumGaussDeterminant>0);
    assert.ok(r.quality.relativeDiscreteVolumeError<1e-10);
    assert.ok(checkNoHangingNodes(r.mesh,1e-7).ok);
    const offset=base.thickness*Math.tan(angleDegrees*Math.PI/180);
    assert.ok(Math.abs(r.plan.offset-offset)<1e-12);
    let core=0,boundary=0;
    zero.mesh.nodes.forEach((p,i)=>{
      const q=r.mesh.nodes[i];assert.equal(q[1],p[1]);assert.equal(q[2],p[2]);
      if(Math.max(Math.abs(p[0]),Math.abs(p[1]))<=base.coreHalfSize+1e-9){
        assert.ok(Math.abs(q[0]-p[0]-offset*(p[2]/base.thickness-.5))<1e-9);core++;
      }
      if(Math.abs(Math.hypot(p[0],p[1])-base.radius)<1e-9){
        assert.ok(Math.hypot(...q.map((v,a)=>v-p[a]))<1e-9);boundary++;
      }
    });
    assert.ok(core>0&&boundary>0);
  });
}

test('circular tilt rejects unsupported cut geometry and invalid angles',()=>{
  for(const angleDegrees of [90,-90,NaN,Infinity,85,-85])assert.throws(()=>generateCircularGradedMesh({...base,angleDegrees}));
  assert.throws(()=>generateCircularGradedMesh({...base,angleDegrees:15,modelFraction:'quarter'}),/quarter/);
  assert.throws(()=>generateCircularGradedMesh({...base,angleDegrees:15,angleCorrection:true}),/unsupported/);
});
