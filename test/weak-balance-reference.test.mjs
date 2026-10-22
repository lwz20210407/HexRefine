import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildWeakBalanceReference,weakBalanceReferenceSchemeNames} from '../dist/experimental/weak-balance-reference.js';
import {CINO_PRIMAL_SCHEMES,CINO_REFERENCE_COMMIT} from '../dist/experimental/cinolib-primal-data.js';
import {H1_FACES,checkNoHangingNodes,meshToLsdynaKeyword,parseMeshText,minElementEdgeLength} from '../dist/index.js';

const expected=JSON.parse(readFileSync(new URL('./fixtures/weak-balance-reference.json',import.meta.url),'utf8'));
const cycle=loop=>[loop,[...loop].reverse()].flatMap(a=>a.map((_,i)=>[...a.slice(i),...a.slice(0,i)].join('|'))).sort()[0];
function digest(mesh){
  const nodes=mesh.nodes.map(p=>p.map(v=>v.toFixed(12)).join(','));
  const cells=mesh.elements.map(e=>H1_FACES.map(f=>cycle(f.map(n=>nodes[e[n-1]-1]))).sort().join(';')).sort();
  return createHash('sha256').update(cells.join('\n')).digest('hex');
}
function check(result,volume){
  const {mesh,certificate:c,boundaryPartitions,rationalPointKeys}=result;
  assert.equal(c.readyForOriginalMeshInstaller,false);assert.equal(c.engineeringAcceptanceVerified,false);
  assert.equal(c.sourceCommit,expected.sourceCommit);assert.equal(c.hexes,mesh.elements.length);
  assert.ok(Math.abs(c.volume-volume)<1e-12);assert.ok(c.minimumCornerSJ>0);assert.ok(c.minimumGaussDeterminant>0);
  assert.equal(Object.keys(boundaryPartitions).length,6);assert.equal(rationalPointKeys.length,mesh.nodes.length);
  assert.equal(new Set(rationalPointKeys).size,rationalPointKeys.length);
  assert.ok(checkNoHangingNodes(mesh,1e-10).ok);
  mesh.nodes.forEach((point,i)=>rationalPointKeys[i].split(',').forEach((r,a)=>{
    const [n,d]=r.split('/').map(Number);assert.ok(Number.isSafeInteger(n)&&Number.isSafeInteger(d)&&d>0);
    assert.equal(n/d,point[a]);
  }));
  Object.entries(boundaryPartitions).forEach(([plane,parts])=>{
    assert.equal(parts.length,c.boundaryFaceCounts[plane]);assert.equal(new Set(parts).size,parts.length);
  });
}

test('pinned primal schemes are not treated as ready H8 connectivity',()=>{
  assert.equal(weakBalanceReferenceSchemeNames.length,13);assert.ok(Object.isFrozen(weakBalanceReferenceSchemeNames));
  assert.equal(CINO_REFERENCE_COMMIT,expected.sourceCommit);
  for(const scheme of weakBalanceReferenceSchemeNames){
    const result=buildWeakBalanceReference([{scheme}]);check(result,1);
    assert.equal(result.mesh.elements.length,CINO_PRIMAL_SCHEMES[scheme].points.length);
    assert.notEqual(result.mesh.elements.length,CINO_PRIMAL_SCHEMES[scheme].polys.length);
    assert.equal(result.certificate.interfaceBridgingHexes,0);
  }
});

test('all thirteen reference primitives remain valid under24 rotations and24 reflections',()=>{
  for(const scheme of weakBalanceReferenceSchemeNames){
    const original=buildWeakBalanceReference([{scheme}]);
    for(let frame=0;frame<48;frame++){
      const transformed=buildWeakBalanceReference([{scheme,frame}]);check(transformed,1);
      assert.equal(transformed.mesh.elements.length,original.mesh.elements.length);
      assert.ok(Math.abs(transformed.certificate.minimumCornerSJ-original.certificate.minimumCornerSJ)<1e-12);
      assert.deepEqual(Object.values(transformed.certificate.boundaryFaceCounts).sort((a,b)=>a-b),Object.values(original.certificate.boundaryFaceCounts).sort((a,b)=>a-b));
    }
  }
});

test('five jointly installed WB neighbours reproduce independent Python geometry and topology',()=>{
  for(const pair of expected.pairs){
    const result=buildWeakBalanceReference(pair.tiles);check(result,2);
    assert.equal(result.mesh.elements.length,pair.hexes);assert.equal(result.mesh.nodes.length,pair.nodes);
    assert.equal(result.certificate.interfaceBridgingHexes,pair.bridges);assert.ok(pair.bridges>0);
    assert.ok(Math.abs(result.certificate.minimumCornerSJ-pair.minimumCornerSJ)<1e-12);
    assert.equal(digest(result.mesh),pair.canonicalMeshSha256);
    assert.deepEqual(buildWeakBalanceReference(pair.tiles),result);
    const text=meshToLsdynaKeyword(result.mesh,{coordinateFormat:'compact',coordinatePrecision:12}),back=parseMeshText(text,'reference.k');
    assert.deepEqual(back.elements,result.mesh.elements);
    const tolerance=minElementEdgeLength(result.mesh)*1e-8;
    result.mesh.nodes.forEach((p,i)=>p.forEach((v,a)=>assert.ok(Math.abs(v-back.nodes[i][a])<=tolerance)));
    assert.ok(checkNoHangingNodes(back,1e-10).ok);
  }
});

test('incompatible reference neighbours and unsupported options are refused',()=>{
  const tiles=[{scheme:'Flat'},{scheme:'Flat'}],before=JSON.stringify(tiles);
  assert.throws(()=>buildWeakBalanceReference(tiles),/unmatched internal primal face/);assert.equal(JSON.stringify(tiles),before);
  for(const scheme of ['not-a-scheme','toString','__proto__']) assert.throws(()=>buildWeakBalanceReference([{scheme}]),/unknown primal scheme/);
  for(const frame of [-1,.5,48,NaN,Infinity]) assert.throws(()=>buildWeakBalanceReference([{scheme:'Flat',frame}]),/reference frame/);
  for(const tiles of [[],[{scheme:'Flat'},{scheme:'Flat'},{scheme:'Flat'}],null]) assert.throws(()=>buildWeakBalanceReference(tiles),/one or two/);
  assert.throws(()=>buildWeakBalanceReference([{scheme:'Flat',unsafe:true}]),/unknown reference tile option/);
  assert.throws(()=>buildWeakBalanceReference([null]),/unknown reference tile option/);
});
